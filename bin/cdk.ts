import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StepBatchStack } from "../cdk/stacks/step-batch-stack";
import { AwsSolutionsChecks } from "cdk-nag";
import { Aspects } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";

const app = new cdk.App();
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
const stack = new StepBatchStack(app, "StepBatchStack");

NagSuppressions.addStackSuppressions(stack, [
  {
    id: "AwsSolutions-S1",
    reason: "overkill for this small sample",
  },
  {
    id: "AwsSolutions-IAM4",
    reason: "Managed policies are sufficient for a sample of this size",
  },
  {
    id: "AwsSolutions-IAM5",
    reason: "Some dynamic wildcard permissions are required for several service actions",
  },
]);
