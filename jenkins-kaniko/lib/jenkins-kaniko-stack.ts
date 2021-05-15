import * as cdk from '@aws-cdk/core';
import {Duration, RemovalPolicy} from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as route53 from '@aws-cdk/aws-route53';
import * as ecrDeploy from 'cdk-ecr-deployment'
import * as path from 'path';
import {HostedZone} from '@aws-cdk/aws-route53';
import {DockerImageAsset} from '@aws-cdk/aws-ecr-assets';
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

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'jenkins-task-definition', {
            memoryLimitMiB: 1024,
            cpu: 512,
            family: 'jenkins'
        });

        taskDefinition.addContainer('jenkins', {
            image: ecs.ContainerImage.fromRegistry("jenkins/jenkins:lts"),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'jenkins'}),
            portMappings: [{
                containerPort: 8080
            }]
        });

        const service = new ecs.FargateService(this, 'JenkinsService', {
            cluster,
            taskDefinition,
            desiredCount: 1,
            maxHealthyPercent: 100,
            minHealthyPercent: 0,
            healthCheckGracePeriod: Duration.minutes(5)
        });

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
                targets: [service],
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

        const kanikoBuilderRepository = new ecr.Repository(this, 'KanikoBuilderRepository', {
            repositoryName: 'kaniko-builder',
            removalPolicy: RemovalPolicy.DESTROY
        });

        const image = new DockerImageAsset(this, 'KanikoBuilderDockerImage', {
            directory: path.join(__dirname, 'kaniko-builder'),
        });

        new ecrDeploy.ECRDeployment(this, 'DeployKanikoBuilderDockerImage', {
            src: new ecrDeploy.DockerImageName(image.imageUri),
            dest: new ecrDeploy.DockerImageName(`${kanikoBuilderRepository.repositoryUri}:latest`)
        });

        const kanikoDemoRepository = new ecr.Repository(this, 'KanikoDemoRepository', {
            repositoryName: 'kaniko-demo',
            removalPolicy: RemovalPolicy.DESTROY
        });

        const role = new Role(this, 'KanikoECSRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
        });

        role.addToPolicy(new PolicyStatement({
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
    }
}
