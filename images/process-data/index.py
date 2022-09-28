'''
    Batch step 2: Using the IDs from the initial step and the data from batch step 1
    Process the data and create results from it
'''
import os
import json


def process_data(data):
    '''
    This is a stand-in for something more complex in lieu of something like a model
    '''
    results = []

    for record in data:
        results.append({
            'timestamp': record['timestamp'],
            'open': record['value'] > 15000
        })
    return results


def run():
    '''
    For each ID, load the data provisioned in the first batch job
    Then do a small transformation on the data, in this case a simple open/close flag if the
    data value is greater than 15000
    Save save the data for each ID back into EFS in the results directory
    '''
    guid = os.environ.get('STEP_FN_ID') or 'unknown'
    index = os.environ.get('AWS_BATCH_JOB_ARRAY_INDEX') or '0'

    working_dir = f"./batch/{guid}/{index}/"

    prep_dir = f"{working_dir}/prep"
    data_dir = f"{working_dir}/data"
    results_dir = f"{working_dir}/results"

    # Make sure the results directory exists for this node
    os.mkdir(results_dir)

    # Read in the IDs provisioned by the initial lambda
    ids = open(f'{prep_dir}/data.csv', 'r', encoding='utf-8')

    lines = ids.readlines()

    for line in lines:
        sanitised_line = line.replace('\n', '')
        data_string = open(f'{data_dir}/{sanitised_line}.json',
                           'r', encoding='utf-8')
        data_json = json.loads(data_string.read())
        results = process_data(data_json)

        with open(f'{results_dir}/{sanitised_line}.json', 'w', encoding='utf-8') as file_handler:
            file_handler.write(json.dumps(results))


run()
