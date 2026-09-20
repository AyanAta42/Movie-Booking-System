# Deploying to AWS (ECS on Fargate)

This takes the stack you run locally with `docker compose --profile stack` and
runs it on AWS: two browsing servers, two booking servers and the website,
behind a load balancer, talking to real hosted databases.

Allow **2–3 hours** the first time. Most of it is clicking through the AWS
console once so you understand every piece; deploying changes afterwards is one
command.

> **Before you start:** this costs about **US$4 a day** while it is running (see
> [step 1](#1-what-it-costs--read-this-first)). Turn it off when you are not
> using it ([step 15](#15-turning-it-off)).

AWS renames buttons from time to time. If a label below does not match exactly,
look for the closest match — the concepts do not change.

---

## 0. The big picture

```
                          the internet
                               │
                ┌──────────────▼──────────────┐
                │  Application Load Balancer  │  one public address
                │  (ALB), port 80             │  routes by path, spreads load,
                └───┬───────────┬──────────┬──┘  checks health
                    │           │          │
      /api/movies   │   /api/shows         │  everything else
      /api/cinemas  │   /api/reservations  │
             ┌──────▼───┐  ┌────▼─────┐  ┌─▼────┐
             │ browsing │  │ booking  │  │ web  │   ECS services on Fargate:
             │   × 2    │  │   × 2    │  │  × 1 │   your containers, on servers
             └────┬─────┘  └────┬─────┘  └──────┘   AWS runs for you
                  │             │
          MongoDB Atlas    Amazon RDS
          (Mongo, free)    (Postgres)                 hosted databases
```

It is the same shape as your local stack. Each piece has an AWS equivalent:

| Locally | On AWS | In plain English |
|---|---|---|
| Docker images on your PC | **ECR** (Elastic Container Registry) | AWS's Docker Hub. Your images live here. |
| `docker compose` | **ECS** (Elastic Container Service) | Runs your containers and keeps them running. |
| Your PC's Docker Desktop | **Fargate** | The "no servers to manage" mode of ECS. You never see a machine. |
| A `services:` entry | **Task definition** | The recipe: image, CPU, memory, settings, secrets. |
| One running container | **Task** | One copy of the recipe running. A replica. |
| `deploy.replicas: 2` | **Service** | "Always keep 2 tasks running; replace any that die." |
| The nginx gateway | **ALB** (Application Load Balancer) | The single front door. |
| An nginx `upstream` block | **Target group** | The list of tasks one kind of request can go to. |
| An nginx `location` block | **Listener rule** | "If the path matches this, send it to that target group." |
| Nothing (Docker's network is open) | **Security group** | A firewall around each piece: who may connect, on which port. |
| The `postgres` container | **RDS** | Postgres run, patched and backed up by AWS. |
| The `mongo` container | **MongoDB Atlas** | Mongo run by MongoDB's company, on AWS hardware. Has a free tier. |
| `DATABASE_URL` in compose | **Parameter Store** | A safe place for connection strings. ECS hands them to containers at start-up. |
| `docker logs` | **CloudWatch Logs** | Where every container's output goes. |
| The `migrate` container | A one-off **task** from the `mbp-ops` image | Runs migrations (or the seed), then exits. |

### Load balancer or API gateway?

People use "API gateway" for two different things:

- **The pattern:** one front door that routes requests to the right service.
  That is what your nginx gateway does locally, and what the **ALB** does on
  AWS. This guide uses an ALB.
- **The AWS product called Amazon API Gateway:** a managed front door with extra
  features on top — API keys, per-customer rate limits, request validation,
  sign-in checks. It charges per request and is usually put in front of
  serverless functions. You do not need it yet. If you later want per-user rate
  limiting on reservations, it (or AWS WAF) can sit in front of the ALB.

### What happens to one request

1. The browser looks up the ALB's address and sends `GET /api/shows/…/seats`.
2. The ALB checks its **listener rules** top to bottom. `/api/shows*` matches
   the booking rule.
3. The rule forwards to the **booking target group**, which lists the two
   booking tasks.
4. The ALB picks a **healthy** one (it takes turns) and forwards the request to
   that task's private address on port 4000.
5. The booking task queries RDS and replies. The ALB passes the reply back.

Every 10 seconds the ALB calls each task's `/health`. If a task fails twice in
a row, it stops sending it traffic, and ECS starts a replacement. When you
deploy new code, ECS starts new tasks first, waits for them to pass health
checks, then drains and stops the old ones — so the site never goes down.

---

## 1. What it costs — read this first

Rough monthly cost if you leave everything running 24/7 in Sydney
(`ap-southeast-2`):

| Piece | Roughly |
|---|---|
| 5 Fargate tasks (0.25 CPU, 512 MB each) | US$55 |
| Application Load Balancer | US$20–25 |
| RDS Postgres, `db.t4g.micro` + 20 GB | US$18 |
| Public IP addresses (~8, US$3.65 each) | US$29 |
| Logs, image storage, Parameter Store | US$1–2 |
| MongoDB Atlas M0 | free |
| **Total** | **about US$125/month, or US$4/day** |

These are estimates. Use the [AWS Pricing Calculator](https://calculator.aws/)
for exact figures. US regions are 15–20% cheaper, but slower from Australia.

**New accounts:** AWS changed its free tier in July 2025. At the time of
writing, new accounts get credits (US$100 on sign-up, plus up to US$100 more
for trying services) and choose between a *Free plan* and a *Paid plan*. Check
the sign-up page for the current terms. If the Free plan blocks something in
this guide, upgrade to the Paid plan; your unused credits carry over.

**The habit that matters:** scale everything to zero when you finish a session
([step 15](#15-turning-it-off)). A demo left running for a month costs more
than a month of doing it properly.

---

## 2. Create and secure your AWS account

1. Go to <https://aws.amazon.com> → **Create an AWS account**. You need an
   email, a phone number and a card (even on the Free plan).
2. **Protect the root user.** The email you signed up with is the *root user*
   and can do anything, including close the account. Sign in as root → click
   your account name (top right) → **Security credentials** → **Assign MFA
   device** → use an authenticator app.
3. **Pick your region.** Top right of the console, choose **Asia Pacific
   (Sydney) ap-southeast-2**. *Everything in this guide must be in the same
   region.* Creating something in the wrong region is the most common reason
   "it can't find my database".
4. **Set a budget alert.** Search **Budgets** → **Create budget** →
   **Customize (advanced)** → **Cost budget** → Monthly, fixed amount **$20** →
   under **Advanced options**, untick **Credits** (so alerts track real usage
   even while credits are paying the bill) → add alerts at 50% and 100% of
   *actual* spend, with your email.
5. **Make an everyday admin user** so you stop using root:
   1. Search **IAM Identity Center** → **Enable**.
   2. **Users** → **Add user** → your username and email. Accept the email
      invitation and set a password.
   3. **Permission sets** → **Create permission set** → **Predefined** →
      **AdministratorAccess**.
   4. **AWS accounts** → tick your account → **Assign users or groups** → your
      user → **AdministratorAccess**.
   5. Copy the **AWS access portal URL** from the Identity Center dashboard
      (it looks like `https://d-xxxxxxxxxx.awsapps.com/start`).
   6. Sign out of root. Sign in through the portal URL from now on. Use root
      only for billing.

---

## 3. Install the AWS command line and sign in

In PowerShell:

```powershell
winget install -e --id Amazon.AWSCLI
```

Close and reopen the terminal, then check it worked with `aws --version`.

Connect it to your account:

```powershell
aws configure sso
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| SSO session name | `mbp` |
| SSO start URL | your access portal URL from step 2 |
| SSO region | `ap-southeast-2` |
| SSO registration scopes | press Enter |

A browser window opens. Approve it, then back in the terminal pick your account
and **AdministratorAccess**. Then:

| Prompt | Answer |
|---|---|
| Default client Region | `ap-southeast-2` |
| CLI default output format | `json` |
| Profile name | `default` (so you never have to type `--profile`) |

Test it:

```powershell
aws sts get-caller-identity
```

It prints your 12-digit **account id**. Note it down; you need it in step 8.

The sign-in lasts several hours. When a command says the token has expired, run
`aws sso login`.

---

## 4. Firewalls: security groups

A **security group** is a firewall attached to something. It lists who may
connect in, and on which port. You make six, all in the **default VPC** (the
private network every AWS account starts with).

Console: search **EC2** → left menu **Security Groups** → **Create security
group**. For each one, set the name, pick the default VPC, add the inbound
rules below, and leave outbound as it is (allow all).

| Name | Inbound rules | Protects |
|---|---|---|
| `mbp-alb-sg` | HTTP, port 80, source **Anywhere-IPv4** | The load balancer |
| `mbp-web-sg` | HTTP, port 80, source **mbp-alb-sg** | Website tasks |
| `mbp-browsing-sg` | Custom TCP, port 4000, source **mbp-alb-sg** | Browsing tasks |
| `mbp-booking-sg` | Custom TCP, port 4000, source **mbp-alb-sg** | Booking tasks |
| `mbp-ops-sg` | *(none)* | Migration and seed jobs |
| `mbp-rds-sg` | PostgreSQL, port 5432, source **mbp-booking-sg**; and a second rule, PostgreSQL, port 5432, source **mbp-ops-sg** | The Postgres database |

To pick another security group as the source, start typing `sg-` or the group's
name in the source box. Create `mbp-alb-sg` first, because the others point at
it.

Look at `mbp-rds-sg`: only booking and the ops jobs may reach Postgres.
**Browsing cannot connect to it at all.** That is the same rule
`tests/architecture/boundaries.test.ts` enforces in the code, now enforced by
the network too.

---

## 5. Postgres: Amazon RDS (booking's database)

Console: search **RDS** → **Create database**.

| Setting | Choose |
|---|---|
| Creation method | **Standard create** |
| Engine | **PostgreSQL**, version 16 |
| Template | **Free tier** (or **Dev/Test** if Free tier is not offered) |
| DB instance identifier | `mbp-postgres` |
| Master username | `mbp` |
| Credentials management | **Self managed**, and type a password |
| Instance class | `db.t4g.micro` |
| Storage | gp3, 20 GiB, **untick** storage autoscaling |
| Compute resource | Don't connect to an EC2 compute resource |
| VPC | the default VPC |
| Public access | **No** |
| VPC security group | **Choose existing** → remove `default`, add `mbp-rds-sg` |
| Additional configuration → **Initial database name** | `mbp` ← easy to miss, and required |
| Backup retention | 1 day |
| Deletion protection | unticked (so you can delete it later) |

Use a password of **letters and numbers only**. It goes inside a URL, where
characters like `@`, `/`, `:` and `#` break things unless you URL-encode them.

Creating it takes 5–10 minutes. When the status says **Available**, open it and
copy the **Endpoint** (something like
`mbp-postgres.abc123xyz.ap-southeast-2.rds.amazonaws.com`).

Your Postgres connection string is:

```
postgresql://mbp:YOUR_PASSWORD@YOUR_ENDPOINT:5432/mbp?schema=public&connection_limit=20&sslmode=require
```

- `connection_limit=20` is per booking task. Two tasks use 40 of the roughly 80
  connections a `db.t4g.micro` allows. Adding tasks does **not** add database
  capacity; watch this number if you scale booking up.
- `sslmode=require` encrypts the connection. RDS insists on it.

---

## 6. Mongo: MongoDB Atlas (browsing's database)

AWS's own Mongo-compatible service (DocumentDB) starts at around US$60 a month.
MongoDB Atlas has a free tier that runs on AWS hardware, so use that.

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a cluster** → **M0 (Free)** → provider **AWS** → region **Sydney
   (ap-southeast-2)**, or the closest one offered → name it `mbp`.
3. **Database Access** → **Add new database user** → username `mbp`, a long
   random password (letters and numbers again), role **Read and write to any
   database**.
4. **Network Access** → **Add IP address** → **Allow access from anywhere**
   (`0.0.0.0/0`).

   *Why "anywhere"?* Your Fargate tasks get a new public IP every time they
   start, so there is no fixed address to allow. Fixing that costs money (a NAT
   gateway, around US$45 a month, or a paid Atlas tier with private
   networking). Your protection is the long password plus the encrypted
   connection Atlas always uses. It's fine for a portfolio project, but you
   wouldn't accept it for real customer data.
5. **Connect** → **Drivers** → copy the connection string. It looks like
   `mongodb+srv://mbp:<password>@mbp.abcde.mongodb.net/?retryWrites=true&w=majority`.
   Put your password in, and add the database name `mbp_catalog` straight after
   `.net/`:

```
mongodb+srv://mbp:YOUR_PASSWORD@mbp.abcde.mongodb.net/mbp_catalog?retryWrites=true&w=majority
```

---

## 7. Store the connection strings safely: Parameter Store

The connection strings contain passwords, so they never go in the task
definitions or in git. They go in **Parameter Store**, and ECS hands each
container only the one it is allowed to see.

Console: search **Systems Manager** → left menu **Parameter Store** → **Create
parameter**. Make two:

| Name | Tier | Type | Value |
|---|---|---|---|
| `/mbp/DATABASE_URL` | Standard | **SecureString** | the Postgres string from step 5 |
| `/mbp/MONGO_URL` | Standard | **SecureString** | the Atlas string from step 6 |

Leave the KMS key as the default (`alias/aws/ssm`). Standard parameters are free.

The task definitions already say who gets what: browsing receives only
`MONGO_URL`, booking only `DATABASE_URL`, and the ops job both, because the seed
fills both databases.

---

## 8. Permission for ECS to read them: the task execution role

ECS needs permission to pull your images, write logs and read those two
parameters. That permission is an **IAM role**.

Console: search **IAM** → **Roles**.

- If a role called `ecsTaskExecutionRole` already exists, open it.
- Otherwise: **Create role** → trusted entity **AWS service** → use case
  **Elastic Container Service** → **Elastic Container Service Task** → **Next**
  → tick **AmazonECSTaskExecutionRolePolicy** → name it exactly
  `ecsTaskExecutionRole` → **Create role**, then open it.

Then give it the parameters: **Add permissions** → **Create inline policy** →
**JSON**, paste this (put your account id from step 3 in place of
`123456789012`), and save it as `mbp-read-parameters`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:GetParameters",
      "Resource": "arn:aws:ssm:ap-southeast-2:123456789012:parameter/mbp/*"
    }
  ]
}
```

---

## 9. Upload your images and register the task definitions

Make sure Docker Desktop is running, then from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\aws\publish.ps1
```

(`-ExecutionPolicy Bypass` is needed because Windows blocks scripts by
default.)

It:

1. builds three images for Linux:
   - `mbp-api`: browsing *and* booking, one image in two roles
   - `mbp-ops`: migrations and the seed
   - `mbp-web`: the website
2. creates the ECR repositories if they don't exist, logs in, and uploads the
   images;
3. creates the `/ecs/mbp` log group;
4. fills your account id, region and time zone into
   `deploy/aws/task-definitions/*.json`. The results go in
   `deploy/aws/rendered/`, which is gitignored;
5. registers the four task definitions with ECS.

The first upload takes a while on home internet. Check the results in the
console: **ECR** shows `mbp-api`, `mbp-ops` and `mbp-web`, and **ECS → Task
definitions** shows `mbp-browsing`, `mbp-booking`, `mbp-web` and `mbp-ops`.

To test the build without touching AWS, run
`powershell -ExecutionPolicy Bypass -File .\deploy\aws\publish.ps1 -DryRun`.

---

## 10. Create the cluster, then fill the databases

**The cluster.** A cluster is just a named home for your services. Go to **ECS**
→ **Clusters** → **Create cluster**, name it `mbp`, choose **AWS Fargate
(serverless)** only, and click **Create**.

**Run the migrations.** This creates Postgres's tables.

1. Open cluster `mbp` → **Tasks** tab → **Run new task**.
2. Compute options: **Launch type**, **FARGATE**.
3. Application type: **Task**. Task definition family: `mbp-ops`, latest revision.
4. Networking: default VPC, keep all subnets. Security group: remove `default`
   and choose **`mbp-ops-sg`**. **Public IP: turned on.** Without a public IP
   the task can't reach ECR to download its image.
5. Click **Create**.

The task runs for about 30 seconds, then stops. Open it and check that
**Containers** shows exit code **0**. The **Logs** tab should say
`All migrations have been successfully applied.`

**Run the seed.** This fills both databases with cinemas, films, shows and seats.

Do the same as above, but before clicking **Create**, expand **Container
overrides** → `ops` → **Command override**, and enter:

```
npm,run,seed
```

The console wants commas and no spaces. The logs should end with three lines:

```
[seed:mongo] 8 movies upserted, 8 total in catalog
[seed:postgres] 3 cinemas, 8 screens, 1600 seats, 224 shows, 44800 show_seats
[seed:projection] 3 cinemas, 224 showtimes -> Mongo
```

The seed schedules seven days of shows from the day it runs. Run it again later
to refresh them. It wipes all bookings, just as it does locally.

---

## 11. The load balancer

**Three target groups**, one per kind of request. Go to **EC2** → left menu
**Target Groups** → **Create target group**:

| Setting | browsing | booking | web |
|---|---|---|---|
| Target type | **IP addresses** | IP addresses | IP addresses |
| Name | `mbp-browsing-tg` | `mbp-booking-tg` | `mbp-web-tg` |
| Protocol : port | HTTP : **4000** | HTTP : **4000** | HTTP : **80** |
| VPC | default | default | default |
| Health check path | `/health` | `/health` | `/` |
| Advanced health check: healthy / unhealthy threshold | 2 / 2 | 2 / 2 | 2 / 2 |
| Advanced health check: interval | 10 s | 10 s | 10 s |

Fargate tasks are reached by IP address, which is why the target type is **IP
addresses**. On the next screen, **don't register any targets**; ECS does that
for you. Click **Create**.

After creating each one, open it → **Attributes** → **Edit** → set
**Deregistration delay** to **30** seconds. The default of 300 makes every
deploy wait five minutes for old tasks to drain.

**The load balancer.** Go to **EC2** → **Load Balancers** → **Create load
balancer** → **Application Load Balancer**:

| Setting | Choose |
|---|---|
| Name | `mbp-alb` |
| Scheme | **Internet-facing** |
| IP address type | IPv4 |
| VPC | default; tick **every** availability zone listed (at least 2 are required) |
| Security groups | remove `default`, add **`mbp-alb-sg`** |
| Listener | HTTP : 80, default action **Forward to `mbp-web-tg`** |

**The routing rules**, which do the job of `gateway/nginx.conf`. Open `mbp-alb`
→ **Listeners and rules** → **HTTP:80** → **Add rule**. Add three:

| Priority | Name | Condition: path is | Action |
|---|---|---|---|
| 10 | browsing | `/api/movies*` **or** `/api/cinemas*` | Forward to `mbp-browsing-tg` |
| 20 | booking | `/api/shows*` **or** `/api/reservations*` | Forward to `mbp-booking-tg` |
| 30 | api-404 | `/api/*` | **Return fixed response**: 404, content type `application/json`, body `{"error":"not_found","message":"No service handles this path"}` |

Add both paths to a single **Path** condition; use its "add value" option for
the second one. Anything matching none of the rules goes to the website, the
listener's default action.

The ALB forwards `/api/movies` unchanged. It can't strip the `/api` prefix the
way nginx could, which is why the services answer under `/api` themselves.

---

## 12. The services: keep the right number of copies running

Go to **ECS** → cluster `mbp` → **Services** → **Create**. Make three:

| Setting | browsing | booking | web |
|---|---|---|---|
| Compute options | Launch type, FARGATE | same | same |
| Application type | Service | Service | Service |
| Task definition family | `mbp-browsing` | `mbp-booking` | `mbp-web` |
| Service name | `browsing` | `booking` | `web` |
| Desired tasks | **2** | **2** | 1 |
| Networking: security group | `mbp-browsing-sg` | `mbp-booking-sg` | `mbp-web-sg` |
| Networking: public IP | **on** | **on** | **on** |
| Load balancing | Application Load Balancer, **existing** `mbp-alb` | same | same |
| Listener | existing **80:HTTP** | same | same |
| Target group | existing `mbp-browsing-tg` | existing `mbp-booking-tg` | existing `mbp-web-tg` |
| Health check grace period | 30 s | 30 s | 30 s |

Keep the default subnets and the default VPC.

The service names must be exactly `browsing`, `booking` and `web`. That's how
`publish.ps1 -Deploy` finds them.

Each service takes a minute or two. It's ready when it shows **2/2 tasks
running** (1/1 for web) and its target group lists that many **healthy**
targets.

---

## 13. Try it

Go to **EC2** → **Load Balancers** → `mbp-alb` and copy its **DNS name**, for
example `mbp-alb-1234567890.ap-southeast-2.elb.amazonaws.com`. Open
`http://` plus that name in your browser. That's your site, live on the
internet. Pick a cinema, a showing, some seats, and book them.

**Watch the load balancing.** In PowerShell:

```powershell
$alb = "http://mbp-alb-1234567890.ap-southeast-2.elb.amazonaws.com"
1..6 | % { (Invoke-WebRequest "$alb/api/movies" -UseBasicParsing).Headers['X-Served-By'] }
```

It alternates between two `browsing@…` names, one for each of your two tasks.

**Kill a server and watch nothing happen.** Go to **ECS** → `booking` →
**Tasks**, tick one, and click **Stop**. Keep using the site: every request goes
to the survivor. Within about a minute ECS notices it has one task instead of
two and starts a replacement. The target group shows it register and turn
healthy.

**Read the logs.** Go to **CloudWatch** → **Log groups** → `/ecs/mbp`. There's
one stream per task, named by service, for example `booking/booking/<task id>`.

**See the database split for yourself.** Go to **RDS** → `mbp-postgres` →
**Monitoring**. Browse the site heavily, and the connections and CPU don't move,
because browsing never touches Postgres. Then make some bookings and watch them
move.

---

## 14. Deploying changes

After you change code:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\aws\publish.ps1 -Deploy
```

It rebuilds, uploads, registers new task definition revisions, and tells each
service to roll onto them. ECS replaces tasks one at a time, waiting for each
new one to pass its health check, so the site stays up throughout.

**If the change includes a database migration**, the order matters:

1. Run `publish.ps1` **without** `-Deploy`.
2. Run the `mbp-ops` task, as in step 10.
3. Run `publish.ps1 -Deploy`.

This way the schema is ready before any code that needs it starts. It's the same
reason the local compose makes booking wait for `migrate`.

**Rolling back:** open the service → **Update service** → choose the previous
task definition revision → **Update**. Every old revision is kept.

---

## 15. Turning it off

**Pausing for a few days:**

1. Open each ECS service → **Update service** → **Desired tasks: 0**. This stops
   the Fargate charges.
2. Go to **RDS** → `mbp-postgres` → **Actions** → **Stop temporarily**. AWS
   restarts it automatically after 7 days, so stop it again if you're still
   away.
3. The load balancer charges about US$0.60 a day even when idle. For a pause
   longer than a few days, delete it (recreating it takes about 10 minutes), or
   delete everything.

**Deleting everything**, in this order, because each item depends on the next:

1. ECS services: set to 0, then **Delete**. Then delete the `mbp` cluster.
2. Load balancer `mbp-alb`, then the three target groups.
3. RDS `mbp-postgres`. Untick "create final snapshot" and confirm.
4. ECR repositories `mbp-api`, `mbp-ops`, `mbp-web`.
5. CloudWatch log group `/ecs/mbp`, and the two parameters in Parameter Store.
6. The six security groups. They can only be deleted once nothing uses them.
7. The Atlas M0 cluster is free, so you can leave it.

Afterwards, check **Billing** → **Bills** the next day to confirm nothing is
still charging.

---

## 16. When something goes wrong

| What you see | Usually means |
|---|---|
| Task stops with `ResourceInitializationError: unable to pull secrets` | The role from step 8 is missing the inline policy, a parameter name is wrong, or the task has no public IP. |
| Task stops with `CannotPullContainerError` | No public IP, the images were never uploaded (step 9), or they're in a different region. |
| `exec format error` in the logs | The image was built for ARM (an M-series Mac). `publish.ps1` builds for `linux/amd64`, so rebuild with it. |
| Targets stay **unhealthy** | The task's security group doesn't allow the port from `mbp-alb-sg`, or `/health` is failing. Check the task's logs. |
| Browsing unhealthy, logs say `MongooseServerSelectionError` | Atlas Network Access is missing `0.0.0.0/0`, the password is wrong, or the password has special characters. |
| Booking unhealthy, logs say `Can't reach database server` | `mbp-rds-sg` doesn't allow `mbp-booking-sg`, or the endpoint in `/mbp/DATABASE_URL` is wrong. |
| The site shows **503** | No healthy targets at all. Check the target groups. |
| The site loads but has no films or showtimes | The seed hasn't run (step 10). |
| Showtimes are at odd hours | The seed and browsing ran in different time zones. Both use `TZ` from the task definitions, which `publish.ps1 -TimeZone` sets. |
| `aws` says the token expired | Run `aws sso login`. |

---

## 17. Once it works

These are good next steps, and good things to be able to talk about:

- **HTTPS.** Buy a domain in Route 53, get a free certificate from ACM, add an
  HTTPS listener to the ALB, and redirect HTTP to it.
- **Infrastructure as code.** Rebuild everything in this guide as Terraform or
  AWS CDK, so the whole environment comes up with one command and goes away
  with another. That also fixes the cost problem, because you can tear it down
  every night.
- **Load test from inside AWS.** Testing from your laptop measures your home
  internet as much as the system. A small EC2 instance in the same region gives
  numbers that mean something: throughput, p95/p99 latency, and where the
  ceiling is (DECISIONS entry 1 predicts it's Postgres).
- **Auto scaling.** Let ECS add booking tasks when CPU or requests per task go
  up. Watch the Postgres connection budget from step 5 when you do.
- **Private networking.** Move the tasks into private subnets with no public IP,
  reaching ECR and Parameter Store through VPC endpoints or a NAT gateway. It
  costs more, but it's how production is usually run.
- **Kubernetes (EKS).** It runs the same images. The EKS control plane alone
  costs about US$73 a month, so learn it once the ECS version is solid.
