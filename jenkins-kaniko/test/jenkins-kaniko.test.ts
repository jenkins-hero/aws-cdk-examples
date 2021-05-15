import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as JenkinsKaniko from '../lib/jenkins-kaniko-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new JenkinsKaniko.JenkinsKanikoStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
