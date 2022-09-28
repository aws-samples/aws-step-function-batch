'''
    Batch step 1: Using the IDs from the initial lambda, 'get' the data aligned to them
    In this case it generates some random data
    But in reality you would get that from somewhere else i.e. a DB
'''
import os
import random
import json


def get_id_data(start_timestamp):
    '''
    Just generating data here, but otherwise you would get it from elsewhere in your cloud setup
    '''
    line_data = []
    count = 0
    while count < 500:
        count += 1
        line_data.append({
            'timestamp': start_timestamp + (count * 60000 * 60),
            'value': random.randrange(10, 20000)
        })
    return line_data


def run():
    '''
    Same pattern as before. Get the Ids from EFS that have been provisioned
    '''
    guid = os.environ.get('STEP_FN_ID') or 'unknown'
    index = os.environ.get('AWS_BATCH_JOB_ARRAY_INDEX') or '0'

    working_dir = f"./batch/{guid}/{index}/"

    # use this pattern to test locally
    # working_dir = "test-data/1"

    prep_dir = f"{working_dir}/prep"
    data_dir = f"{working_dir}/data"

    ids = open(f'{prep_dir}/data.csv', 'r', encoding='utf-8')

    lines = ids.readlines()
    start_timestamp = 1663639968158

    os.mkdir(data_dir)

    for line in lines:
        sanitised_line = line.replace('\n', '')
        line_data = get_id_data(start_timestamp)
        with open(f'{data_dir}/{sanitised_line}.json', 'w', encoding='utf-8') as file_handler:
            file_handler.write(json.dumps(line_data))


run()
