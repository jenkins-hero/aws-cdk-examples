#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { JenkinsKanikoStack } from '../lib/jenkins-kaniko-stack';

const app = new cdk.App();
new JenkinsKanikoStack(app, 'JenkinsKanikoStack', {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION}
});
