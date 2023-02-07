# jenkins-master with CDK

Sample Jenkins implementation in CDK, including:

* VPC, subnets, load balancer, and other network setup
* Jenkins deployment to ECS using serverless Fargate containers
* single master, with automatic failover to 2nd availability zone
* persistent storage with EFS
* secure access over HTTPS, with optional registration into a hosted zone

## Deploying

Install required npm packages:

`npm install`

Ensure you have the following environment variables set:
* `CDK_DEFAULT_ACCOUNT=<your-aws-account-id>`
* `CDK_DEFAULT_REGION=<aws-region>`

Decide what values (if any) you want to pass for these optional context parameters.

* **hostedZoneName** is the name of a Route 53 hosted zone into which a `jenkins` CNAME record will be added e.g. set
to `tomgregory.com` to register a CNAME record `jenkins.tomgregory.com` pointing at the load balancer DNS record.  This will additionall create the ACM certificat for this new subdomain.

Then run this command:

`cdk deploy --context hostedZoneName=<hosted-zone-name>`

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
