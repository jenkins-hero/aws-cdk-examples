import * as cdk from '@aws-cdk/core';
import {Duration, RemovalPolicy} from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import {Port} from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as route53 from '@aws-cdk/aws-route53';
import {HostedZone} from '@aws-cdk/aws-route53';

export class JenkinsMasterStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'jenkins-vpc', {
            cidr: "10.0.0.0/16"
        })

        const cluster = new ecs.Cluster(this, 'jenkins-cluster', {
            vpc,
            clusterName: 'jenkins-cluster'
        });

        const fileSystem = new efs.FileSystem(this, 'JenkinsFileSystem', {
            vpc: vpc,
            removalPolicy: RemovalPolicy.DESTROY
        });

        const accessPoint = fileSystem.addAccessPoint('AccessPoint', {
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

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'jenkins-task-definition', {
            memoryLimitMiB: 1024,
            cpu: 512,
            family: 'jenkins'
        });

        taskDefinition.addVolume({
            name: 'jenkins-home',
            efsVolumeConfiguration: {
                fileSystemId: fileSystem.fileSystemId,
                transitEncryption: 'ENABLED',
                authorizationConfig: {
                    accessPointId: accessPoint.accessPointId,
                    iam: 'ENABLED'
                }
            }
        });

        const containerDefinition = taskDefinition.addContainer('jenkins', {
            image: ecs.ContainerImage.fromRegistry("jenkins/jenkins:lts"),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'jenkins'}),
            portMappings: [{
                containerPort: 8080
            }]
        });
        containerDefinition.addMountPoints({
            containerPath: '/var/jenkins_home',
            sourceVolume: 'jenkins-home',
            readOnly: false
        });

        const service = new ecs.FargateService(this, 'JenkinsService', {
            cluster,
            taskDefinition,
            desiredCount: 1,
            maxHealthyPercent: 100,
            minHealthyPercent: 0,
            healthCheckGracePeriod: Duration.minutes(5)
        });
        service.connections.allowTo(fileSystem, Port.tcp(2049));

        const hostedZoneName = this.node.tryGetContext('hostedZoneName');
        if (hostedZoneName) {
            const hostedZone = route53.HostedZone.fromLookup(this, 'baseZone', {
                domainName: hostedZoneName
            });

            const subdomain = `jenkins.${hostedZoneName}`;
            const myCertificate = new acm.DnsValidatedCertificate(this, 'mySiteCert', {
                domainName: subdomain,
                hostedZone: hostedZone,
            });
            const certificateArn = myCertificate.certificateArn
        
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

            new route53.CnameRecord(this, 'CnameRecord', {
                zone: hostedZone,
                recordName: 'jenkins',
                domainName: loadBalancer.loadBalancerDnsName,
                ttl: Duration.minutes(1)
            });
            
        }
    }
}
