FROM --platform=linux/amd64 public.ecr.aws/amazonlinux/amazonlinux:latest

RUN yum install python3 -y
RUN yum install pip -y

RUN python3 -m pip install boto3 awswrangler
RUN yum install awscli nfs-utils -y

RUN mkdir /batch
RUN mkdir /src

ADD index.py /src/index.py
ENTRYPOINT python3 /src/index.py