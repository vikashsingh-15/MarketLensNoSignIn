# MarketLens — AWS Deployment Guide

## Architecture

```
Internet → ALB → ECS Fargate (Express API + Agenda) → MongoDB Atlas
```

The server serves both the API and the React client (static files from `client/dist/`).

---

## 1. Build & Test Locally

```bash
cd MarketLens
npm install && npm install --prefix server && npm install --prefix client
npm run build
docker build -t marketlens .
docker run -p 8000:8000 \
  -e MONGODB_URI="mongodb+srv://..." \
  -e SESSION_SECRET="your-secret" \
  -e CLIENT_URL="https://your-domain.com" \
  -e GOOGLE_CLIENT_ID="..." \
  -e GOOGLE_CLIENT_SECRET="..." \
  -e GOOGLE_CALLBACK_URL="https://your-domain.com/api/auth/google/callback" \
  -e CEREBRAS_API_KEY="..." \
  marketlens
```

Verify: `curl http://localhost:8000/api/health` → `{"status":"ok","service":"MarketLens API"}`

---

## 2. Push to Amazon ECR

```bash
# Create ECR repository (once)
aws ecr create-repository --repository-name marketlens --region ap-south-1

# Login to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

# Build & push
docker build -t marketlens .
docker tag marketlens:latest <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/marketlens:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/marketlens:latest
```

---

## 3. Deploy on ECS Fargate

### Create the cluster (once)
```bash
aws ecs create-cluster --cluster-name marketlens --region ap-south-1
```

### Create the task definition
Save this as `task-definition.json`:

```json
{
  "family": "marketlens",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "marketlens",
      "image": "<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/marketlens:latest",
      "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "8000" },
        { "name": "CLIENT_URL", "value": "https://your-domain.com" },
        { "name": "GOOGLE_CALLBACK_URL", "value": "https://your-domain.com/api/auth/google/callback" },
        { "name": "RSS_RUN_ON_STARTUP", "value": "true" }
      ],
      "secrets": [
        { "name": "MONGODB_URI", "valueFrom": "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/marketlens/MONGODB_URI" },
        { "name": "SESSION_SECRET", "valueFrom": "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/marketlens/SESSION_SECRET" },
        { "name": "GOOGLE_CLIENT_ID", "valueFrom": "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/marketlens/GOOGLE_CLIENT_ID" },
        { "name": "GOOGLE_CLIENT_SECRET", "valueFrom": "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/marketlens/GOOGLE_CLIENT_SECRET" },
        { "name": "CEREBRAS_API_KEY", "valueFrom": "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/marketlens/CEREBRAS_API_KEY" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/marketlens",
          "awslogs-region": "ap-south-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -qO- http://localhost:8000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Store secrets in SSM Parameter Store
```bash
aws ssm put-parameter --name "/marketlens/MONGODB_URI" --value "mongodb+srv://..." --type SecureString
aws ssm put-parameter --name "/marketlens/SESSION_SECRET" --value "$(openssl rand -hex 32)" --type SecureString
aws ssm put-parameter --name "/marketlens/GOOGLE_CLIENT_ID" --value "..." --type SecureString
aws ssm put-parameter --name "/marketlens/GOOGLE_CLIENT_SECRET" --value "..." --type SecureString
aws ssm put-parameter --name "/marketlens/CEREBRAS_API_KEY" --value "..." --type SecureString
```

### Create the service
```bash
aws ecs create-service \
  --cluster marketlens \
  --service-name marketlens-service \
  --task-definition marketlens \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=marketlens,containerPort=8000"
```

---

## 4. Set Up ALB (Application Load Balancer)

1. Create a target group (port 8000, health check: `/api/health`)
2. Create an ALB pointing to the target group
3. Create an HTTPS listener with an ACM certificate for your domain
4. Point your domain's DNS to the ALB

---

## 5. Google OAuth Callback URL

Update in Google Cloud Console → Credentials → OAuth 2.0 Client:
- **Authorized redirect URIs**: add `https://your-domain.com/api/auth/google/callback`
- Remove `http://localhost:8000/api/auth/google/callback` (or keep for dev)

---

## 6. Key Production Settings

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8000` |
| `CLIENT_URL` | `https://your-domain.com` |
| `MONGODB_URI` | Your Atlas URI (with auth DB) |
| `SESSION_SECRET` | Strong random hex string |
| `GOOGLE_CALLBACK_URL` | `https://your-domain.com/api/auth/google/callback` |
| `RSS_RUN_ON_STARTUP` | `true` |
| `CEREBRAS_API_KEY` | Your key |

**What happens automatically in production:**
- Cookie `secure: true` (HTTPS only)
- Express serves `client/dist/` as static files
- SPA catch-all serves `index.html` for client-side routes
- Agenda runs background jobs (RSS, calendar, strategy scans)
- Sessions stored in MongoDB Atlas (same connection)

---

## 7. Cost Estimate (AWS ap-south-1)

| Service | Monthly estimate |
|---|---|
| ECS Fargate (0.5 vCPU, 1GB, always-on) | ~$10 |
| ALB | ~$5 (low traffic) |
| ECR | ~$0.05 |
| CloudWatch logs | ~$1 |
| **Total** | **~$16/month** |

MongoDB Atlas is separate (you already have it).

---

## 8. Alternative: Elastic Beanstalk (simpler)

If you prefer PaaS over containers:

```bash
cd MarketLens
npm run build
# Create a Procfile
echo "web: node server/dist/server.js" > Procfile
# Deploy
eb init -p docker marketlens --region ap-south-1
eb create marketlens-env --instance_type t3.small
# Set env vars
eb setenv NODE_ENV=production PORT=8000 CLIENT_URL=https://your-domain.com ...
```

Elastic Beanstalk handles ALB, scaling, and health checks for you.

---

## Deployment Checklist

- [ ] `npm run build` succeeds locally
- [ ] Docker image builds and runs locally
- [ ] ECR repository created
- [ ] Image pushed to ECR
- [ ] SSM secrets stored
- [ ] ECS cluster + task definition + service created
- [ ] ALB + target group + HTTPS listener configured
- [ ] Domain DNS points to ALB
- [ ] ACM certificate issued for domain
- [ ] Google OAuth callback URL updated
- [ ] `curl https://your-domain.com/api/health` returns 200
- [ ] Login flow works end-to-end
- [ ] Background jobs running (check logs)
