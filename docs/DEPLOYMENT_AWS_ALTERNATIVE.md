# Deploying PnL Lens on AWS

Region: **ap-south-1 (Mumbai)**. Everything below is standard AWS; no third-party hosting or database.

> AWS App Runner stopped accepting new customers on 30 April 2026, so this guide uses
> **ECS on Fargate behind an Application Load Balancer**. (ECS Express Mode, AWS's simplified front end
> for the same stack, is an acceptable shortcut if you prefer it.)

## Architecture

```
Route 53 (DNS) ──► ACM certificate ──► Application Load Balancer (HTTPS :443, redirect :80)
                                              │  health check: GET /api/health
                                              ▼
                               ECS Fargate service "lens-web" (2 tasks, private subnets)
                               image: ECR lens:<git-sha>   port 3000
                               secrets from AWS Secrets Manager
                                              │  5432, security-group restricted
                                              ▼
                               RDS for PostgreSQL 16 (private subnets, encrypted, SSL forced)

EventBridge Scheduler ──(daily 20:30 UTC = 02:00 IST)──► ECS RunTask: node scripts/purge.mjs
ECS one-off task on each deploy ──► node scripts/migrate.mjs  (master credentials)
CloudWatch Logs ◄── all tasks        CloudWatch Alarms ◄── ALB 5xx, RDS CPU/storage, task count
```

## Services used

| AWS service | Purpose | Starting size |
|---|---|---|
| VPC | 2 public subnets (ALB), 2 private subnets (tasks, RDS), NAT gateway for outbound (Razorpay, Google sign-in) | 2 AZs |
| RDS for PostgreSQL 16 | Database | db.t4g.micro → db.t4g.small; 20 GB gp3; 7-day backups; encryption on; Multi-AZ when revenue justifies |
| ECR | Docker image registry | lifecycle: keep last 20 images |
| ECS on Fargate | Runs the app container | 0.5 vCPU / 1 GB, 2 tasks, autoscale on CPU 60% up to 6 |
| Application Load Balancer | HTTPS termination, health checks | idle timeout 60 s |
| ACM | TLS certificate for your domain | free |
| Route 53 | DNS | 1 hosted zone |
| Secrets Manager | DATABASE_URL, SESSION_SECRET, OTP_PEPPER, GOOGLE_CLIENT_SECRET, Razorpay keys | one secret per value |
| Amazon SES | Sign-in code emails | verified domain (DKIM), production access |
| CloudFront (recommended) | In front of the ALB; adds `CloudFront-Viewer-Country` used for ₹ vs $ pricing, plus caching of static assets | |
| EventBridge Scheduler | Nightly purge task | 1 schedule |
| CloudWatch | Logs (30-day retention) and alarms | |
| IAM | Task execution role (pull ECR, read secrets), task role with `ses:SendEmail` on your identity, GitHub OIDC deploy role | |

## Step by step

### 1. Network
Create a VPC with 2 public + 2 private subnets across 2 AZs and one NAT gateway.
Security groups:
- `sg-alb`: inbound 443/80 from 0.0.0.0/0
- `sg-web`: inbound 3000 from `sg-alb` only
- `sg-db`: inbound 5432 from `sg-web` only

### 2. Database
1. Create **RDS for PostgreSQL 16** in the private subnets with `sg-db`, public access **off**, storage encryption on, automated backups 7 days, deletion protection on.
2. In a custom parameter group set `rds.force_ssl = 1`.
3. Store the master credentials in Secrets Manager (RDS can manage this for you).
4. Database name: `lens`.

### 3. Image
```bash
aws ecr create-repository --repository-name lens --region ap-south-1
docker build -t lens .
docker tag lens:latest <acct>.dkr.ecr.ap-south-1.amazonaws.com/lens:<git-sha>
docker push <acct>.dkr.ecr.ap-south-1.amazonaws.com/lens:<git-sha>
```
The image already contains the RDS CA bundle at `/app/rds-ca.pem`.

### 4. Migrations (first deploy and every deploy)
Register a task definition `lens-migrate` from the same image with command
`["node","scripts/migrate.mjs"]` and env:
- `MIGRATE_DATABASE_URL` = master URL (from Secrets Manager)
- `DATABASE_SSL=require`

Run it once with `aws ecs run-task` in the private subnets. Then, **once only**, set the app role's password:
```sql
alter role lens_app login password '<generate, store in Secrets Manager>';
```
Never run `db/seed.sql` in production.

### 5. App service
Task definition `lens-web`, port 3000, CloudWatch log group `/ecs/lens-web`.

| Env var | Value |
|---|---|
| `NODE_ENV` | production (set by the image) |
| `STORE_DRIVER` | `pg` |
| `AUTH_MODE` | `jwt` (use `dev` only on a private staging stack, and never set `ALLOW_DEV_AUTH_IN_PROD` in production) |
| `DATABASE_URL` | secret: `postgres://lens_app:<pw>@<rds-endpoint>:5432/lens` |
| `DATABASE_SSL` | `require` |
| `SESSION_SECRET`, `OTP_PEPPER` | secrets |
| `APP_URL` | `https://yourdomain.com` |
| `MAIL_DRIVER`, `MAIL_FROM`, `SES_REGION` | `ses`, `PnL Lens <no-reply@yourdomain.com>`, `ap-south-1` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud Console (secret in Secrets Manager) |
| `RAZORPAY_*` | secrets (phase 5) |
| `REPORT_TTL_DAYS` | `30` |

Create the ECS service: Fargate, 2 desired tasks, private subnets, `sg-web`, attached to an ALB target group (health check path `/api/health`, matcher 200). ALB listener 443 with the ACM cert; listener 80 redirects to 443. Point a Route 53 alias record at the ALB.

### 6. Sign-in services
**Amazon SES (email codes)**
1. SES → Identities → verify your domain; publish the DKIM CNAMEs in Route 53; add an SPF include and a DMARC record.
2. Request **production access** (new accounts are in the sandbox and can only email verified addresses).
3. Give the ECS task role `ses:SendEmail` on that identity. No access keys needed.

**Google sign-in**
1. Google Cloud Console → APIs & Services → OAuth consent screen: app name, support email, logo, privacy policy URL, authorised domain. Scopes: `openid`, `email`, `profile` (non-sensitive, so no Google review needed). Publish to production.
2. Credentials → Create OAuth client ID → Web application. Authorised redirect URI: `https://yourdomain.com/api/auth/google/callback`.
3. Put the client ID in env and the client secret in Secrets Manager. Without them the Google button hides itself and email codes still work.

### 7. Nightly purge
EventBridge Scheduler → target **ECS RunTask**, cron `30 20 * * ? *` (UTC), same image, command
`["node","scripts/purge.mjs"]`, env `DATABASE_URL` (lens_app) + `DATABASE_SSL=require`.
The task logs one JSON line per run; add a CloudWatch alarm if no run is logged in 26 hours.

(An HTTP alternative exists at `POST /api/cron/purge` with `Authorization: Bearer $CRON_SECRET`, but the ECS task is preferred because it doesn't expose an endpoint.)

### 8. Alarms
ALB 5xx > 1% for 5 min · target group unhealthy hosts > 0 · RDS CPU > 80% · RDS free storage < 2 GB ·
ECS running tasks < desired · purge task missing for 26 h · SES bounce rate > 4% or complaint rate > 0.08%.

### 9. CI/CD
`.github/workflows/deploy.yml` builds, pushes to ECR, runs migrations, and rolls the ECS service.
It authenticates with **GitHub OIDC** (no long-lived AWS keys). Fill in the account id, role ARN,
cluster, subnet and security group ids at the top of the file.

## Local production-like run
```bash
docker compose up --build     # Postgres 16 + migrations + app on http://localhost:3000
```
