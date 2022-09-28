'''
Lambda checking step: Checks batch to see if all the jobs are finished.
'''
import boto3

client = boto3.client('batch')


def handler(event, context):
    '''
    Gets the batch IDs from the event, passed in by the step function
    Gets the status of all the IDs from batch
    If all of the jobs are completed/failed/done then mark them all as finished.
    Really you could probably just check the final ID? But this sets the groundwork for using that
    data elsewhere
    '''
    print(event)
    print(context)

    step_1 = event["stepOne"]["JobId"]
    step_2 = event["stepTwo"]["JobId"]
    step_3 = event["stepThree"]["JobId"]

    response = client.describe_jobs(
        jobs=[
            step_1, step_2, step_3
        ]
    )
    finished = True
    jobs = response['jobs']

    for job in jobs:
        print(job['status'])
        if job['status'] == 'RUNNING' or job['status'] == 'PENDING' or job['status'] == 'SUBMITTED':
            finished = False

    return {"finished": finished}
