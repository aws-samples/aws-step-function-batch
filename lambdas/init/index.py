'''
    The first function of the step function. This will provision a random set of IDs
    and it will set up EFS for the rest of the process
'''
import uuid
import random
import os

NODE_TASK_LIMIT = 5

ROOT_MOUNT_DIR = '/mnt/batch'

# for local testing use
# ROOT_MOUNT_DIR = 'mnt/batch'
# and call handler({},{}) at the end of the file


def prep_efs(step_fn_id):
    '''
    Make sure the step function directory exists for this ID in EFS
    '''
    os.mkdir(f'{ROOT_MOUNT_DIR}/{step_fn_id}')


def efs_content_write(node_ids, step_fn_id, node_count):
    '''
    Write the current node ID's to EFS, provision the correct directories for the index
    '''
    content = "\n"

    os.mkdir(f'{ROOT_MOUNT_DIR}/{step_fn_id}/{node_count}')
    os.mkdir(f'{ROOT_MOUNT_DIR}/{step_fn_id}/{node_count}/prep')
    with open(f'{ROOT_MOUNT_DIR}/{step_fn_id}/{node_count}/prep/data.csv', 'w', encoding='utf-8') as file_handler:
        file_handler.write(content.join(node_ids))


def provision_efs_with_ids(ids: [], step_fn_id):
    '''
    Using a set of Ids, at each NODE_TASK_LIMIT place them into efs with their current node
    Batch has context over it's own index so each directory correlates
    with a single batch job array node
    '''
    node_count = 0
    node_ids = []
    for nid in ids:
        node_ids.append(nid)
        if len(node_ids) == NODE_TASK_LIMIT:
            efs_content_write(node_ids, step_fn_id, node_count)
            node_count += 1
            node_ids = []

    if len(node_ids) > 0:
        efs_content_write(node_ids, step_fn_id, node_count)
        node_count += 1
    return node_count


def generate_random_ids():
    '''
    Random id generator. Between a range, generate a guid
    '''
    number_of_ids = random.randrange(20, 50)
    total_id_count = 0
    ids = []
    while total_id_count < number_of_ids:
        ids.append(str(uuid.uuid4()))
        total_id_count += 1
    return ids


def handler(event, context):
    '''
    Provision an ID for this run
    Provision appropriate EFS directories
    Provision a set of IDs and place them into EFS
    Return the count of nodes needed in batch. And the current ID
    '''
    step_fn_id = str(uuid.uuid4())
    prep_efs(step_fn_id)

    ids = generate_random_ids()

    node_count = provision_efs_with_ids(ids, step_fn_id)

    return {"total_nodes": node_count, "step_fn_id": step_fn_id}
