#!/bin/bash
# Just moves data from efs to S3
# You could use this same pattern to extract log files and other data from the batch job runs
echo "Saving data to s3"
aws s3 cp /batch/$STEP_FN_ID/$AWS_BATCH_JOB_ARRAY_INDEX/results/ s3://$RESULTS_BUCKET/$STEP_FN_ID/$AWS_BATCH_JOB_ARRAY_INDEX/results/ --recursive