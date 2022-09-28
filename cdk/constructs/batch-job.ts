import { Construct } from "constructs";
import { CfnComputeEnvironment, CfnJobDefinition, CfnJobQueue } from "aws-cdk-lib/aws-batch";
import { CfnInstanceProfile, Role } from "aws-cdk-lib/aws-iam";
import { Volume } from "aws-cdk-lib/aws-ecs";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import { Fn } from "aws-cdk-lib";

interface BatchJobProps {
  idsPrefix: string;
  vpc: Vpc;
  job: {
    jobRole: Role;
    jobImageLocation: string;
    volume: Volume;
    memory: number;
    vcpus: number;
  };
  compute: {
    batchServiceRole: Role;
    maxvCpus: number;
    minvCpus: number;
    desiredvCpus: number;
    batchInstanceProfile: CfnInstanceProfile;
    securityGroup: SecurityGroup;
  };
}

/**
 * Used to abstract away the repetitive nature of provisioning Batch Job steps many times
 */
export class BatchJob extends Construct {
  computeEnvironment: CfnComputeEnvironment;
  jobDefinition: CfnJobDefinition;
  jobQueue: CfnJobQueue;
  jobDefARN: string;
  constructor(construct: Construct, id: string, props: BatchJobProps) {
    super(construct, id);
    const { idsPrefix, vpc } = props;
    const { jobRole, jobImageLocation, volume, memory, vcpus } = props.job;
    const { batchServiceRole, maxvCpus, minvCpus, desiredvCpus, batchInstanceProfile, securityGroup } = props.compute;

    // The compute environment that will dictate the parameters of the ECS cluster that is provisioned to support the batch jobs
    this.computeEnvironment = new CfnComputeEnvironment(this, `${idsPrefix}ComputeEnvironment`, {
      computeEnvironmentName: `${idsPrefix}ComputeEnvironment`,
      serviceRole: batchServiceRole.roleArn,
      computeResources: {
        instanceRole: batchInstanceProfile.ref,
        allocationStrategy: "BEST_FIT",
        desiredvCpus: desiredvCpus,
        maxvCpus: maxvCpus,
        minvCpus: minvCpus,
        type: "EC2",
        instanceTypes: ["optimal"],
        subnets: vpc.privateSubnets.map((sub) => sub.subnetId),
        securityGroupIds: [securityGroup.securityGroupId],
      },
      type: "MANAGED",
    });

    // The job queue to hold the batch job array nodes ready to process
    this.jobQueue = new CfnJobQueue(this, `${idsPrefix}JobQueue`, {
      computeEnvironmentOrder: [
        {
          computeEnvironment: this.computeEnvironment.attrComputeEnvironmentArn,
          order: 0,
        },
      ],
      priority: 1,
      jobQueueName: `${idsPrefix}JobQueue`,
    });

    // The docker image of the batch job
    const jobDockerImage = new DockerImageAsset(this, `${idsPrefix}JobDefinitionDockerImage`, {
      directory: jobImageLocation,
    });

    // The definition of the batch job. This is used to launch batch jobs from the step function.
    // It acts as a template.
    this.jobDefinition = new CfnJobDefinition(this, `${idsPrefix}JobDefinition`, {
      type: "container",
      jobDefinitionName: `${idsPrefix}JobDefinition`,
      containerProperties: {
        image: jobDockerImage.imageUri,
        // The vCPU and memory requirements for the batch job task
        vcpus: vcpus,
        memory: memory,
        jobRoleArn: jobRole.roleArn,
        volumes: [volume],
        // Where to mount the EFS volume
        mountPoints: [{ sourceVolume: volume.name, containerPath: "/batch", readOnly: false }],
      },
    });

    // The CfnJobDefinition doesn't expose the ARN but it's needed further down the line. Get it using cfn REF
    this.jobDefARN = Fn.ref(this.jobDefinition.logicalId);
  }
}
