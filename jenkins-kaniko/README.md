# Jenkins for Kaniko

Sample Jenkins implementation in CDK, including all the AWS resources required to run Kaniko.

* Kaniko build context S3 bucket
* Kaniko task definition
* Kaniko security group
* Kaniko task role
* Kaniko execution role
* Kaniko target repository

Environment variables for all the relevant resources are also added to the Jenkins ECS task, ready to be
used in a Jenkins pipeline.

## Deploying

Install required npm packages:

`npm install`

Ensure you have the following environment variables set:
* `CDK_DEFAULT_ACCOUNT=<your-aws-account-id>`
* `CDK_DEFAULT_REGION=<aws-region>`

Decide what values (if any) you want to pass for these optional context parameters.

* **certificateArn** is the ARN of a Certificate Manager certificate to be attached to the load balancer listener.
  If this isn't provided you won't be able to access your Jenkins instance.
* **hostedZoneName** is the name of a Route 53 hosted zone into which a `jenkins` CNAME record will be added e.g. set
  to `tomgregory.com` to register a CNAME record `jenkins.tomgregory.com` pointing at the load balancer DNS record

Then run this command:

`cdk deploy --context certificateArn=<certificate-arn> --context hostedZoneName=<hosted-zone-name>`

Once your stack has been created, you can access Jenkins by entering the admin password from the ECS task logs.
Choose to not install any plugins, as the required plugins are preconfigured. Create a new user, then on the main 
Jenkins page you can run the provided *kaniko-example* job to see Kaniko in action.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
