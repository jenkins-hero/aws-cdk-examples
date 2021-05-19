import * as cdk from '@aws-cdk/core';
import {Duration, RemovalPolicy} from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as s3 from '@aws-cdk/aws-s3';
import {Port} from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as route53 from '@aws-cdk/aws-route53';
import {HostedZone} from '@aws-cdk/aws-route53';
import {PolicyStatement, Role, ServicePrincipal} from "@aws-cdk/aws-iam";

export class JenkinsKanikoStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'jenkins-vpc', {
            cidr: "10.0.0.0/16"
        })

        const cluster = new ecs.Cluster(this, 'jenkins-cluster', {
            vpc,
            clusterName: 'jenkins-cluster'
        });

        const kanikoBuildContextBucket = new s3.Bucket(this, 'KanikoBuildContextBucket', {
            bucketName: 'kaniko-build-context',
            versioned: true,
            removalPolicy: RemovalPolicy.DESTROY
        });

        const kanikoDemoRepository = new ecr.Repository(this, 'KanikoDemoRepository', {
            repositoryName: 'kaniko-demo',
            removalPolicy: RemovalPolicy.DESTROY
        });

        const kanikoTaskRole = new Role(this, 'KanikoECSRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
        });

        kanikoTaskRole.addToPolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:InitiateLayerUpload',
                'ecr:UploadLayerPart',
                'ecr:CompleteLayerUpload',
                'ecr:PutImage',
                'ecr:BatchGetImage',
                'ecr:BatchCheckLayerAvailability'
            ],
        }));
        kanikoTaskRole.addToPolicy(new PolicyStatement({
            resources: [`${kanikoBuildContextBucket.bucketArn}/*`],
            actions: [
                's3:GetObject'
            ],
        }));

        const kanikoTaskDefinition = new ecs.FargateTaskDefinition(this, 'kaniko-task-definition', {
            memoryLimitMiB: 1024,
            cpu: 512,
            family: 'kaniko-builder',
            taskRole: kanikoTaskRole
        });
        kanikoTaskDefinition.addToExecutionRolePolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage'
            ]
        }));

        kanikoTaskDefinition.addContainer('kaniko', {
            image: ecs.ContainerImage.fromRegistry(`tkgregory/kaniko-for-ecr:latest`),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'kaniko'})
        });

        const kanikoSecurityGroup = new ec2.SecurityGroup(this, 'KanikoSecurityGroup', {
            securityGroupName: 'kaniko-security-group',
            vpc: vpc
        });
        new cdk.CfnOutput(this, 'KanikoSecurityGroupId', {value: kanikoSecurityGroup.securityGroupId});
        new cdk.CfnOutput(this, 'PublicSubnetId', {value: vpc.publicSubnets[0].subnetId});
        new cdk.CfnOutput(this, 'PrivateSubnetId', {value: vpc.privateSubnets[0].subnetId});


        const jenkinsFileSystem = new efs.FileSystem(this, 'JenkinsFileSystem', {
            vpc: vpc,
            removalPolicy: RemovalPolicy.DESTROY
        });

        const jenkinsAccessPoint = jenkinsFileSystem.addAccessPoint('AccessPoint', {
            path: '/jenkins-home',
            posixUser: {
                uid: '1000',
                gid: '1000',
            },
            createAcl: {
                ownerGid: '1000',
                ownerUid: '1000',
                permissions: '755'
            }
        });

        const jenkinsTaskRole = new Role(this, 'JenkinsTaskRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
        });
        jenkinsTaskRole.addToPolicy(new PolicyStatement({
            resources: [`${kanikoBuildContextBucket.bucketArn}/*`],
            actions: [
                's3:PutObject'
            ],
        }));

        jenkinsTaskRole.addToPolicy(new PolicyStatement({
            resources: [kanikoTaskDefinition.taskDefinitionArn],
            actions: [
                'ecs:RunTask'
            ],
        }));
        jenkinsTaskRole.addToPolicy(new PolicyStatement({
            resources: ['*'],
            actions: [
                'ecs:DescribeTasks',
                'ecs:ListTaskDefinitions'
            ],
        }));

        jenkinsTaskRole.addToPolicy(new PolicyStatement({
            resources: [
                kanikoTaskRole.roleArn,
                kanikoTaskDefinition.obtainExecutionRole().roleArn
            ],
            actions: [
                'iam:PassRole'
            ],
        }));

        const jenkinsTaskDefinition = new ecs.FargateTaskDefinition(this, 'jenkins-task-definition', {
            memoryLimitMiB: 3072,
            cpu: 1024,
            family: 'jenkins',
            taskRole: jenkinsTaskRole
        });

        jenkinsTaskDefinition.addVolume({
            name: 'jenkins-home',
            efsVolumeConfiguration: {
                fileSystemId: jenkinsFileSystem.fileSystemId,
                transitEncryption: 'ENABLED',
                authorizationConfig: {
                    accessPointId: jenkinsAccessPoint.accessPointId,
                    iam: 'ENABLED'
                }
            }
        });

        const jenkinsContainerDefinition = jenkinsTaskDefinition.addContainer('jenkins', {
            image: ecs.ContainerImage.fromRegistry("tkgregory/jenkins-for-kaniko:latest"),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'jenkins'}),
            portMappings: [{
                containerPort: 8080
            }],
            environment: {
                KANIKO_CLUSTER_NAME: cluster.clusterName,
                KANIKO_SUBNET_ID: vpc.privateSubnets[0].subnetId,
                KANIKO_SECURITY_GROUP_ID: kanikoSecurityGroup.securityGroupId,
                KANIKO_TASK_FAMILY_PREFIX: kanikoTaskDefinition.family,
                KANIKO_BUILD_CONTEXT_BUCKET_NAME: kanikoBuildContextBucket.bucketName,
                KANIKO_REPOSITORY_URI: kanikoDemoRepository.repositoryUri
            }
        });
        jenkinsContainerDefinition.addMountPoints({
            containerPath: '/var/jenkins_home',
            sourceVolume: 'jenkins-home',
            readOnly: false
        });

        const jenkinsService = new ecs.FargateService(this, 'JenkinsService', {
            cluster,
            taskDefinition: jenkinsTaskDefinition,
            desiredCount: 1,
            maxHealthyPercent: 100,
            minHealthyPercent: 0,
            healthCheckGracePeriod: Duration.minutes(5)
        });
        jenkinsService.connections.allowTo(jenkinsFileSystem, Port.tcp(2049));

        let certificateArn = this.node.tryGetContext('certificateArn');
        if (certificateArn) {
            const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {vpc, internetFacing: true});
            new cdk.CfnOutput(this, 'LoadBalancerDNSName', {value: loadBalancer.loadBalancerDnsName});

            const listener = loadBalancer.addListener('Listener', {
                port: 443,
                certificateArns: [certificateArn]
            });
            listener.addTargets('JenkinsTarget', {
                port: 8080,
                targets: [jenkinsService],
                deregistrationDelay: Duration.seconds(10),
                healthCheck: {
                    path: '/login'
                }
            });

            const hostedZoneName = this.node.tryGetContext('hostedZoneName')
            if (hostedZoneName) {
                const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
                    domainName: hostedZoneName
                });
                new route53.CnameRecord(this, 'CnameRecord', {
                    zone: hostedZone,
                    recordName: 'jenkins',
                    domainName: loadBalancer.loadBalancerDnsName,
                    ttl: Duration.minutes(1)
                });
            }
        }
    }
}
