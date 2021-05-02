#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import {JenkinsMasterStack} from '../lib/jenkins-master-stack';

const app = new cdk.App();
new JenkinsMasterStack(app, 'JenkinsMasterStack', {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION}
});
