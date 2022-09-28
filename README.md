# Step function Managed Batch Job connected through a common EFS volume

This project is an example of using [AWS Step functions](https://aws.amazon.com/step-functions/?step-functions.sort-by=item.additionalFields.postDateTime&step-functions.sort-order=desc) to manage and track a series of [AWS Batch](https://aws.amazon.com/batch/) jobs in [N_TO_N mode](https://docs.aws.amazon.com/batch/latest/userguide/array_jobs.html).

### Tech:

- AWS Batch
- AWS Step functions
- AWS Lambda
- Amazon S3
- Amazon ECS (Managed by AWS Batch)
- Amazon EFS
- Amazon EventBridge

## Getting started

### Prerequisites:

- [yarn/npm](https://classic.yarnpkg.com/lang/en/docs/install/)
- [aws cdk cli](https://docs.aws.amazon.com/cdk/v2/guide/cli.html)
- [aws cli](https://aws.amazon.com/cli/)
- [Docker](https://www.docker.com/get-started/)

### Standing up:

First:

- Ensure docker engine is running
- Authenticate your shell session with your desired AWS account and region.

Then run:

```
yarn
cdk deploy
```

This may take around 5-10 minutes to deploy initially. Other updates will be faster.

### Tearing down

```
cdk destroy
```

There will be several parts of this sample that CDK will not destroy and have to be destroyed manually after the fact

- EFS Volume
- S3 Bucket
- Cloudwatch log groups

### Validating deployment:

From the AWS console:

- Find the step function launched ('BatchStateMachine{id}').
- Click 'Start execution'. Leave the name and input as the default. The step function will begin and more than likely look like this as it waits for the batch job process to complete:

  ![Batch running](/readme_assets/batch-run.png)

- While it's waiting, click into any of the Batch Job steps and view the resource link. This will show the nodes currently running and if there are any successes/failures.
- Eventually the step function will complete, check the S3 bucket to view the result output of the step function.

## Solution Architecture (High level)

![Solution Design](/readme_assets//simplified.png)

### What's not noted here (but exists in the deployed CDK code)

- AWS IAM (Policies, roles, etc. All documented in CDK code)
- Amazon VPC
- Cloudwatch

### Step function flow:

1. Cron trigger begins step function
2. The first lambda is run and has several responsibilities:
   - Generate a unique Id for the current step function workflow to be passed into subsequent steps
   - Generate a variable range of Ids and then divide them up based on the maximum number of Ids allowed per Batch Job Array Node
   - Provision directories in EFS:
     - A directory for the current step function Id
     - For each calculated node (Id's / Node ID limit) provision a directory
     - A directory /prep to put the Id's in under each node index
   - Return the number of Array nodes required by Batch
3. All three Batch Jobs are started with the size determined by the return of the previous function. These are all started one after the other in rapid succession _without_ waiting for each job to finish running.
   1. Batch Job 1:
      - Loads the Id's for the current index
      - Generates random 'data' for the Ids
   - Provisions a /data directory under the current index
   - Places the new 'data' into the /data directory
   2. Batch Job 2 **(N_TO_N dependency on Batch Job 1)**:
      - Loads the Id's for the current index
      - Loads the data from the previous step
      - Performs a simple function based on the data
      - Provisions a /results directory under the current index
      - Places the function results into the /results directory
   3. Batch Job 3 **(N_TO_N dependency on Batch Job 2)**:
      - Moves the data from the /results directory to the egress s3 bucket
   - Performs a simple function based on the data
   - Provisions a /results directory under the current index
   - Places the function results into the /results directory
4. While these are running a 'watching' lambda is kicked off:
   - Get all 3 Batch Job Ids
   - Check the status of all 3 batch jobs using aws SDK
   - If all 3 are no longer running, finish the step function.

### Visualisation:

![Step function visualisation](/readme_assets/detailed-workflow.png)

## Solution Architecture (Low level)

Another layer of the batch jobs exposed:

![Solution Design](/readme_assets/step-function-batch.png)

### Batch Job detail

These batch jobs are configured to run in N_TO_N mode. Meaning they are all running concurrently and once a node of the same index completes in a prior step, then the batch job can run the same node. i.e. if node 1 finishes in step 1, but node 0 is still running, then node 1 in step 2 can still run.

![Batch Fade Process](/readme_assets/batch-node-fade.png)

Each of these Batch jobs runs in 'Array mode' and can scale up to an array of 10,000 per batch job. These batch jobs can be placed into queues, while batch jobs can share queues and in turn - compute environments - this does have the added side effect of your subsequent steps queuing behind the first batch job, preventing concurrent behaviour.

Each of these batch job queues are on top of a defined compute environment. Once these queues are populated, then the managed ECS portion of batch will spin up a cluster capable of processing the queue. It will either spin up the minimum instances needed to process the queue, so small queues won't request excess resources. OR the managed cluster will spin up enough instances to sit within predefined limits (Max vCPU, min vCPU etc.).

## CDK-NAG

For security best practices cdk-nag is utilised during the cdk process. This can be configured and/or disabled by removing the integration within bin/cdk.ts . More information [here](https://aws.amazon.com/blogs/devops/manage-application-security-and-compliance-with-the-aws-cloud-development-kit-and-cdk-nag/)

## FAQ

### Why 3 batch tasks

In order to demonstrate the N_TO_N nature of batch and how the three typical steps of a data pipeline sit together (Procurement, Processing and Egress), three steps are most appropriate.

### ECS managed clusters

You do not need to manage your own ECS clusters with this solution.

### How high can this scale?

The solution has been tested with 400,000 records across 10,000 batch job array size. According to [this](https://docs.aws.amazon.com/batch/latest/userguide/service_limits.html) service limits page, that is the maximum array size allowed. That page will outline some more of the scaling limits and stay more up to date than this ReadMe.
