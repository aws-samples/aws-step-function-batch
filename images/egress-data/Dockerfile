FROM --platform=linux/amd64 public.ecr.aws/amazonlinux/amazonlinux:latest

RUN yum install awscli nfs-utils -y

COPY './cmd.sh' /cmd.sh
WORKDIR /

RUN mkdir /batch

ENTRYPOINT ["/cmd.sh"]