import * as cdk from '@aws-cdk/core';
import {Duration} from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';

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

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'jenkins-task-definition', {
            memoryLimitMiB: 1024,
            cpu: 512,
            family: 'jenkins'
        });

        const jenkinsPassword = new secretsmanager.Secret(this, 'Secret', {
            secretName: 'JenkinsPasswordSecret'
        });

        taskDefinition.addContainer('jenkins', {
            image: ecs.ContainerImage.fromRegistry("jenkins/jenkins:lts"),
            logging: ecs.LogDrivers.awsLogs({streamPrefix: 'jenkins'}),
            environment: {
                JENKINS_USERNAME: 'developer'
            },
            secrets: {
                JENKINS_PASSWORD: ecs.Secret.fromSecretsManager(jenkinsPassword)
            },
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

        const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {vpc, internetFacing: true});
        const listener = loadBalancer.addListener('Listener', {
            port: 443,
            certificateArns: ['arn:aws:acm:eu-west-1:299404798587:certificate/93b13faf-f41e-4249-91ed-dab5cb78473e']
        });
        listener.addTargets('JenkinsTarget', {
            port: 8080,
            targets: [service],
            deregistrationDelay: Duration.seconds(10),
            healthCheck: {
                path: '/login'
            }
        });
    }
}
