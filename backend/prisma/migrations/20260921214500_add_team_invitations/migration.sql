-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "team_id" TEXT NOT NULL,
    "inviter_user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_hash_key" ON "team_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "team_invitations_team_id_idx" ON "team_invitations"("team_id");

-- CreateIndex
CREATE INDEX "team_invitations_organization_id_idx" ON "team_invitations"("organization_id");

-- CreateIndex
CREATE INDEX "team_invitations_status_idx" ON "team_invitations"("status");

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add enum values to AuditLogAction
ALTER TYPE "AuditLogAction" ADD VALUE 'team_invitation_created';
ALTER TYPE "AuditLogAction" ADD VALUE 'team_invitation_revoked';
ALTER TYPE "AuditLogAction" ADD VALUE 'team_invitation_accepted';