import { Duration, PhysicalName, Stack } from "aws-cdk-lib";
import { FlowLogDestination, FlowLogTrafficType, IpAddresses, Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Volume } from "aws-cdk-lib/aws-ecs";
import { AccessPoint, FileSystem } from "aws-cdk-lib/aws-efs";
import { Runtime, FileSystem as lfs } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import * as lpa from "@aws-cdk/aws-lambda-python-alpha";
import {
  CfnInstanceProfile,
  CompositePrincipal,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { BatchSubmitJob, LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { BatchJob } from "../constructs/batch-job";
import {
  Choice,
  Condition,
  DefinitionBody,
  IntegrationPattern,
  JsonPath,
  LogLevel,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import { LogGroup } from "aws-cdk-lib/aws-logs";

export class StepBatchStack extends Stack {
  constructor(construct: Construct, id: string) {
    super(construct, id);

    // A bucket for the end result of the demo
    const egressBucket = new Bucket(this, "data-egress-bucket", {
      bucketName: PhysicalName.GENERATE_IF_NEEDED,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: new BlockPublicAccess(BlockPublicAccess.BLOCK_ALL),
      enforceSSL: true,
    });

    // VPC for the batch jobs to act within
    const vpc = new Vpc(this, "BatchVpc", {
      ipAddresses: IpAddresses.cidr("100.64.0.0/22"),
      flowLogs: {
        allTraffic: {
          destination: FlowLogDestination.toCloudWatchLogs(),
          trafficType: FlowLogTrafficType.ALL,
        },
      },
    });

    // Security group allowing for efs mounting
    const efsSecurityGroup = new SecurityGroup(this, "BatchJobEfsSg", {
      vpc: vpc,
      description: "EFS Security Group",
    });

    efsSecurityGroup.addIngressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(2049), "NFS Access.");

    // EFS that will hold all of our data during the step function
    const efs = new FileSystem(this, "BatchEFS", {
      vpc: vpc,
      encrypted: true,
      vpcSubnets: {
        onePerAz: true,
      },
      securityGroup: efsSecurityGroup,
      fileSystemName: "BatchEFS",
    });

    // A volume specifically for batch to mount
    const volume: Volume = {
      name: "SharedDataVolume",
      efsVolumeConfiguration: {
        fileSystemId: efs.fileSystemId,
        rootDirectory: "/batch",
      },
    };

    // EFS Access Point for lambda execution to use to connect to EFS.
    const efsAccess = new AccessPoint(this, "BatchJobEfsAp", {
      fileSystem: efs,
      createAcl: {
        ownerGid: "0",
        ownerUid: "0",
        permissions: "777",
      },
      posixUser: {
        uid: "0",
        gid: "0",
      },
      path: "/batch",
    });

    // This lambda creates some random IDs for us to process. And puts them EFS.
    // It splits the indexes up by whatever the array node size is set as.
    // Each set of IDs goes into an /{index} underneath this step functions ID
    const stepFunctionInitLambda = new lpa.PythonFunction(this, "stepFunctionInit", {
      entry: path.join(__dirname, "../../lambdas/init"),
      description: "The init step of the batch flow, this will generate a set of IDs to process",
      handler: "handler",
      memorySize: 2048,
      timeout: Duration.seconds(3),
      runtime: Runtime.PYTHON_3_9,
      environment: {
        EFS_STORE: efs.fileSystemId,
      },
      vpc: vpc,
      filesystem: lfs.fromEfsAccessPoint(efsAccess, "/mnt/batch"),
      securityGroups: [efsSecurityGroup],
    });

    // Allow it to access EFS
    stepFunctionInitLambda.role?.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticFileSystemClientFullAccess")
    );

    // Step function step wrapper
    const startInitJob = new LambdaInvoke(this, "Lambda init task", {
      lambdaFunction: stepFunctionInitLambda,
    });

    // A role for the batch jobs. These could be individual. But for the sake of simplicity keep it all the same
    // This could also be restricted to a specific s3 bucket.
    const jobDefinitionRole = new Role(this, "BatchJobRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticContainerRegistryPublicReadOnly"),
      ],
    });

    egressBucket.grantWrite(jobDefinitionRole);

    // A role for the actual batch EC2 instances
    const batchInstanceRole = new Role(this, "BatchInstanceRole", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("ec2.amazonaws.com"),
        new ServicePrincipal("ecs.amazonaws.com")
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2ContainerServiceforEC2Role"),
      ],
    });

    // The batch instance profile to pass the role into the compute environment
    const batchInstanceProfile = new CfnInstanceProfile(this, "BatchInstanceProfile", {
      roles: [batchInstanceRole.roleName],
    });

    // The batch service role to pass the role into the compute environment
    const batchServiceRole = new Role(this, "BatchServiceRole", {
      assumedBy: new ServicePrincipal("batch.amazonaws.com"),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBatchServiceRole")],
    });

    // A security group for batch within the VPC
    const securityGroup = new SecurityGroup(this, "BatchSG", {
      vpc: vpc,
    });

    // Produces:
    // A batch Job Definition (To launch as a job)
    // A compute environment and a queue to run the jobs on
    const batchJobStep1 = new BatchJob(this, "StepOne", {
      vpc,
      idsPrefix: "StepOne",
      job: {
        jobRole: jobDefinitionRole,
        jobImageLocation: path.join(__dirname, "../../images/get-data"),
        volume,
        memory: 1024 * 2,
        vcpus: 1,
      },
      compute: {
        maxvCpus: 10,
        minvCpus: 0,
        desiredvCpus: 5,
        batchInstanceProfile,
        securityGroup,
        batchServiceRole,
      },
    });

    // Batch Job launcher for step functions. Adds expected params and size.
    // Replicated several times below for various steps
    const stepOne = new BatchSubmitJob(this, "First Batch Job", {
      jobDefinitionArn: batchJobStep1.jobDefARN,
      jobName: "StepOneJob",
      jobQueueArn: batchJobStep1.jobQueue.attrJobQueueArn,
      arraySize: JsonPath.numberAt("$.Payload.total_nodes"),
      resultPath: "$.stepOne",
      // TODO: Note this is important for this pattern. And not the default for step functions
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      containerOverrides: {
        environment: {
          // This id is to ensure the steps know where to look for data.
          // The already have context on their own array number
          STEP_FN_ID: JsonPath.stringAt("$.Payload.step_fn_id"),
        },
      },
    });

    const batchJobStep2 = new BatchJob(this, "StepTwo", {
      vpc,
      idsPrefix: "StepTwo",
      job: {
        jobRole: jobDefinitionRole,
        jobImageLocation: path.join(__dirname, "../../images/process-data"),
        volume,
        // Much larger requirements
        memory: 1024 * 16,
        vcpus: 6,
      },
      compute: {
        maxvCpus: 64,
        minvCpus: 0,
        desiredvCpus: 32,
        batchInstanceProfile,
        securityGroup,
        batchServiceRole,
      },
    });

    const stepTwo = new BatchSubmitJob(this, "Second Batch Job", {
      jobDefinitionArn: batchJobStep2.jobDefARN,
      jobName: "StepTwoJob",
      jobQueueArn: batchJobStep2.jobQueue.attrJobQueueArn,
      arraySize: JsonPath.numberAt("$.Payload.total_nodes"),
      resultPath: "$.stepTwo",
      dependsOn: [{ jobId: JsonPath.stringAt("$.stepOne.JobId"), type: "N_TO_N" }],
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      containerOverrides: {
        environment: {
          STEP_FN_ID: JsonPath.stringAt("$.Payload.step_fn_id"),
        },
      },
    });

    const batchJobStep3 = new BatchJob(this, "StepThree", {
      vpc,
      idsPrefix: "StepThree",
      job: {
        jobRole: jobDefinitionRole,
        jobImageLocation: path.join(__dirname, "../../images/egress-data"),
        volume,
        // Much larger requirements
        memory: 1024 * 1,
        vcpus: 1,
      },
      compute: {
        maxvCpus: 10,
        minvCpus: 0,
        desiredvCpus: 5,
        batchInstanceProfile,
        securityGroup,
        batchServiceRole,
      },
    });

    const stepThree = new BatchSubmitJob(this, "Third Batch Job", {
      jobDefinitionArn: batchJobStep3.jobDefARN,
      jobName: "StepThreeJob",
      jobQueueArn: batchJobStep3.jobQueue.attrJobQueueArn,
      arraySize: JsonPath.numberAt("$.Payload.total_nodes"),
      resultPath: "$.stepThree",
      dependsOn: [{ jobId: JsonPath.stringAt("$.stepTwo.JobId"), type: "N_TO_N" }],
      containerOverrides: {
        environment: {
          RESULTS_BUCKET: egressBucket.bucketName,
          STEP_FN_ID: JsonPath.stringAt("$.Payload.step_fn_id"),
        },
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
    });

    // This lambda checks each batch job launched and acts as a gatekeeper for completing the step function.
    const stepFunctionCheckBatchLambda = new lpa.PythonFunction(this, "stepFunctionCheckBatchLambda", {
      entry: path.join(__dirname, "../../lambdas/check-batch"),
      description: "This step checks the status of the batch jobs run by the step function",
      handler: "handler",
      memorySize: 256,
      timeout: Duration.seconds(3),
      runtime: Runtime.PYTHON_3_9,
      vpc: vpc,
    });

    // Allow the step function to scan for batch job statuses
    stepFunctionCheckBatchLambda.addToRolePolicy(
      new PolicyStatement({
        sid: "batchAllow",
        effect: Effect.ALLOW,
        resources: ["*"],
        actions: ["batch:Describe*"],
      })
    );

    const checkJob = new LambdaInvoke(this, "Lambda check task", {
      lambdaFunction: stepFunctionCheckBatchLambda,
      resultPath: "$.check",
    });

    // A step to simply wait 30 seconds within the step function.
    // A small time buffer to avoid running the stepFunctionCheckBatchLambda too often
    const wait30 = new Wait(this, "Wait 30 Seconds", {
      time: WaitTime.duration(Duration.seconds(30)),
    });

    // Step function Success!
    const batchFinished = new Succeed(this, "Batch processing completed");

    const stepFunctionLogGroup = new LogGroup(this, "StepFunctionLogGroup");

    // Defining the actual step function.
    // 1. Run the init function
    // 2-4. Start the batch jobs
    // 5. Run the 'Check back jobs' lambda
    // 6. Decide: If not finished, run step 5 again. Otherwise finish.
    const stateMachine = new StateMachine(this, "BatchStateMachine", {
      definitionBody: DefinitionBody.fromChainable(startInitJob
        .next(stepOne)
        .next(stepTwo)
        .next(stepThree)
        .next(checkJob)
        .next(
          new Choice(this, "Job Complete?")
            .when(Condition.booleanEquals("$.check.Payload.finished", true), batchFinished)
            .when(Condition.booleanEquals("$.check.Payload.finished", false), wait30.next(checkJob))
        ),
      ),
      logs: { destination: stepFunctionLogGroup, level: LogLevel.ALL },
      tracingEnabled: true,
    });

    egressBucket.grantWrite(stateMachine);

    // Add a schedule to run this once a day
    new Rule(this, "StepBatchManagedFunctionRule", {
      ruleName: "StepBatchManagedFunctionRule",
      schedule: Schedule.rate(Duration.days(1)),
      targets: [new SfnStateMachine(stateMachine)],
    });
  }
}
