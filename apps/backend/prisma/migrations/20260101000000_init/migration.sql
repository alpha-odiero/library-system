-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "public"."MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "public"."CopyStatus" AS ENUM ('AVAILABLE', 'BORROWED', 'RESERVED', 'LOST', 'DAMAGED', 'MAINTENANCE', 'REMOVED');

-- CreateEnum
CREATE TYPE "public"."CopyCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "public"."LoanStatus" AS ENUM ('ACTIVE', 'RETURNED', 'OVERDUE', 'LOST', 'DAMAGED');

-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('ACTIVE', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."FineType" AS ENUM ('OVERDUE', 'LOST', 'DAMAGE', 'LATE_RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."FineStatus" AS ENUM ('OUTSTANDING', 'PARTIAL', 'PAID', 'WAIVED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('BOOK_DUE_SOON', 'BOOK_OVERDUE', 'RESERVATION_READY', 'FINE_CREATED', 'FINE_PAYMENT', 'BOOK_RETURNED', 'GENERAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'LOGOUT_ALL', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'EMAIL_VERIFIED', 'BOOK_CREATED', 'BOOK_UPDATED', 'BOOK_ARCHIVED', 'AUTHOR_CREATED', 'AUTHOR_UPDATED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'PUBLISHER_CREATED', 'PUBLISHER_UPDATED', 'COPY_CREATED', 'COPY_UPDATED', 'COPY_MOVED', 'COPY_REMOVED', 'MEMBER_CREATED', 'MEMBER_UPDATED', 'MEMBER_DELETED', 'MEMBER_TYPE_CREATED', 'MEMBER_TYPE_UPDATED', 'LOAN_CREATED', 'BOOK_RETURNED', 'BOOK_RENEWED', 'LOAN_MARKED_LOST', 'LOAN_MARKED_DAMAGED', 'RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'RESERVATION_READY', 'RESERVATION_EXPIRED', 'RESERVATION_FULFILLED', 'FINE_CREATED', 'FINE_UPDATED', 'FINE_PAID', 'FINE_WAIVED', 'PAYMENT_VOIDED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'ROLE_CHANGED', 'PERMISSION_CHANGED', 'SETTINGS_UPDATED', 'BRANCH_CREATED', 'BRANCH_UPDATED', 'LIBRARY_CREATED', 'DIGITAL_RESOURCE_CREATED', 'DIGITAL_RESOURCE_DELETED', 'DIGITAL_ACCESS', 'REPORT_EXPORTED', 'AUDIT_EXPORTED');

-- CreateEnum
CREATE TYPE "public"."DigitalType" AS ENUM ('PDF', 'EPUB', 'PREVIEW', 'LINK', 'AUDIO');

-- CreateEnum
CREATE TYPE "public"."AccessLevel" AS ENUM ('MEMBER', 'LOAN_HOLDER', 'STAFF', 'PUBLIC');

-- CreateEnum
CREATE TYPE "public"."SettingsValueType" AS ENUM ('string', 'number', 'boolean', 'json');

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(80) NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32),
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "role_id" UUID NOT NULL,
    "primary_branch_id" UUID,
    "email_verified_at" TIMESTAMP(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" VARCHAR(45),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_branches" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "assigned_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    "device_label" VARCHAR(120),
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(120),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."libraries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "legal_name" VARCHAR(200),
    "email" VARCHAR(255),
    "phone" VARCHAR(32),
    "address" TEXT,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "library_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(32),
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "floor" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shelves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."member_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "max_active_loans" INTEGER NOT NULL DEFAULT 3,
    "loan_duration_days" INTEGER NOT NULL DEFAULT 14,
    "max_renewals" INTEGER NOT NULL DEFAULT 1,
    "renewal_duration_days" INTEGER NOT NULL DEFAULT 14,
    "grace_period_days" INTEGER NOT NULL DEFAULT 0,
    "fine_per_day" DECIMAL(14,2) NOT NULL DEFAULT 50,
    "max_fine_cap" DECIMAL(14,2),
    "reservation_limit" INTEGER NOT NULL DEFAULT 3,
    "hold_duration_days" INTEGER NOT NULL DEFAULT 3,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "membership_number" VARCHAR(30) NOT NULL,
    "user_id" UUID NOT NULL,
    "member_type_id" UUID NOT NULL,
    "home_branch_id" UUID NOT NULL,
    "status" "public"."MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "date_of_birth" DATE,
    "gender" VARCHAR(20),
    "address" TEXT,
    "city" VARCHAR(100),
    "occupation" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."publishers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "imprint" VARCHAR(200),
    "country" VARCHAR(100),
    "website" VARCHAR(255),
    "email" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."authors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "sort_name" VARCHAR(200) NOT NULL,
    "biography" TEXT,
    "nationality" VARCHAR(100),
    "birth_year" INTEGER,
    "death_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(60) NOT NULL,
    "label" VARCHAR(80),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "isbn13" VARCHAR(20),
    "isbn10" VARCHAR(20),
    "title" VARCHAR(400) NOT NULL,
    "subtitle" VARCHAR(400),
    "description" TEXT,
    "edition" VARCHAR(100),
    "language" VARCHAR(50) NOT NULL DEFAULT 'en',
    "publication_year" INTEGER,
    "publication_date" DATE,
    "page_count" INTEGER,
    "publisher_id" UUID,
    "cover_image_url" VARCHAR(500),
    "call_number" VARCHAR(50),
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "is_reference_only" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "archived_reason" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."book_authors" (
    "book_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "role" VARCHAR(30) NOT NULL DEFAULT 'AUTHOR',

    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("book_id","author_id")
);

-- CreateTable
CREATE TABLE "public"."book_categories" (
    "book_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("book_id","category_id")
);

-- CreateTable
CREATE TABLE "public"."book_tags" (
    "book_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "book_tags_pkey" PRIMARY KEY ("book_id","tag_id")
);

-- CreateTable
CREATE TABLE "public"."book_copies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "book_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "location_id" UUID,
    "shelf_id" UUID,
    "accession_number" VARCHAR(50) NOT NULL,
    "barcode" VARCHAR(64) NOT NULL,
    "qr_token" VARCHAR(64) NOT NULL,
    "condition" "public"."CopyCondition" NOT NULL DEFAULT 'GOOD',
    "status" "public"."CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "acquisition_date" DATE,
    "acquisition_source" VARCHAR(50),
    "purchase_price" DECIMAL(14,2),
    "replacement_cost" DECIMAL(14,2),
    "notes" TEXT,
    "removed_at" TIMESTAMP(3),
    "removed_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."copy_status_history" (
    "id" BIGSERIAL NOT NULL,
    "copy_id" UUID NOT NULL,
    "from_status" "public"."CopyStatus",
    "to_status" "public"."CopyStatus" NOT NULL,
    "from_condition" "public"."CopyCondition",
    "to_condition" "public"."CopyCondition",
    "reason" VARCHAR(255),
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(64),

    CONSTRAINT "copy_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "copy_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "issued_by" UUID NOT NULL,
    "member_type_id" UUID NOT NULL,
    "loaned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3) NOT NULL,
    "grace_until" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "returned_by" UUID,
    "status" "public"."LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "renewal_count" INTEGER NOT NULL DEFAULT 0,
    "last_renewed_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "damaged_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loan_status_history" (
    "id" BIGSERIAL NOT NULL,
    "loan_id" UUID NOT NULL,
    "from_status" "public"."LoanStatus",
    "to_status" "public"."LoanStatus" NOT NULL,
    "reason" VARCHAR(255),
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(64),

    CONSTRAINT "loan_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loan_renewals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loan_id" UUID NOT NULL,
    "renewed_by" UUID NOT NULL,
    "renewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previous_due_date" TIMESTAMP(3) NOT NULL,
    "new_due_date" TIMESTAMP(3) NOT NULL,
    "renewal_number" INTEGER NOT NULL,
    "previous_status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(255),

    CONSTRAINT "loan_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "book_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "branch_id" UUID,
    "position" INTEGER NOT NULL,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "hold_expires_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "fulfilled_loan_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(40) NOT NULL,
    "member_id" UUID NOT NULL,
    "loan_id" UUID,
    "type" "public"."FineType" NOT NULL DEFAULT 'OVERDUE',
    "amount" DECIMAL(14,2) NOT NULL,
    "waived_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "public"."FineStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "description" VARCHAR(500) NOT NULL,
    "days_overdue" INTEGER NOT NULL DEFAULT 0,
    "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "waived_at" TIMESTAMP(3),
    "waived_by" UUID,
    "waiver_reason" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fine_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fine_id" UUID NOT NULL,
    "receipt_number" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "public"."PaymentMethod" NOT NULL,
    "reference" VARCHAR(120),
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" UUID NOT NULL,
    "branch_id" UUID,
    "notes" VARCHAR(255),
    "voided_at" TIMESTAMP(3),
    "voided_by" UUID,
    "void_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fine_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "channel" VARCHAR(30) NOT NULL DEFAULT 'IN_APP',
    "action_url" VARCHAR(300),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_email" VARCHAR(255) NOT NULL,
    "actor_role" VARCHAR(50),
    "action" "public"."AuditAction" NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(60),
    "description" VARCHAR(1000) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "value_type" "public"."SettingsValueType" NOT NULL DEFAULT 'string',
    "category" VARCHAR(50) NOT NULL DEFAULT 'general',
    "description" VARCHAR(255),
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."digital_resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "book_id" UUID NOT NULL,
    "type" "public"."DigitalType" NOT NULL DEFAULT 'PDF',
    "title" VARCHAR(200) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(120),
    "size_bytes" BIGINT,
    "access_level" "public"."AccessLevel" NOT NULL DEFAULT 'MEMBER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."digital_loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sync_operations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(100) NOT NULL,
    "operation_type" VARCHAR(30) NOT NULL,
    "payload" JSONB NOT NULL,
    "client_timestamp" TIMESTAMP(3) NOT NULL,
    "base_version" VARCHAR(60),
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "result_id" VARCHAR(60),
    "failure_code" VARCHAR(50),
    "failure_reason" VARCHAR(500),
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "public"."roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "public"."permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "public"."permissions"("resource");

-- CreateIndex
CREATE INDEX "permissions_action_idx" ON "public"."permissions"("action");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "public"."role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "role_permissions_granted_by_idx" ON "public"."role_permissions"("granted_by");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "public"."users"("role_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "public"."users"("status");

-- CreateIndex
CREATE INDEX "users_last_name_first_name_idx" ON "public"."users"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "users_primary_branch_id_idx" ON "public"."users"("primary_branch_id");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "public"."users"("deleted_at");

-- CreateIndex
CREATE INDEX "user_branches_branch_id_idx" ON "public"."user_branches"("branch_id");

-- CreateIndex
CREATE INDEX "user_branches_assigned_by_idx" ON "public"."user_branches"("assigned_by");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "public"."sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "public"."sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "public"."sessions"("family_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "public"."sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "public"."password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "public"."password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "public"."password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "public"."email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "public"."email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "public"."email_verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "libraries_code_key" ON "public"."libraries"("code");

-- CreateIndex
CREATE INDEX "libraries_is_active_idx" ON "public"."libraries"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "public"."branches"("code");

-- CreateIndex
CREATE INDEX "branches_library_id_idx" ON "public"."branches"("library_id");

-- CreateIndex
CREATE INDEX "branches_is_active_idx" ON "public"."branches"("is_active");

-- CreateIndex
CREATE INDEX "locations_branch_id_idx" ON "public"."locations"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_branch_id_code_key" ON "public"."locations"("branch_id", "code");

-- CreateIndex
CREATE INDEX "shelves_location_id_idx" ON "public"."shelves"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_location_id_code_key" ON "public"."shelves"("location_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "member_types_code_key" ON "public"."member_types"("code");

-- CreateIndex
CREATE INDEX "member_types_is_active_idx" ON "public"."member_types"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "members_membership_number_key" ON "public"."members"("membership_number");

-- CreateIndex
CREATE UNIQUE INDEX "members_user_id_key" ON "public"."members"("user_id");

-- CreateIndex
CREATE INDEX "members_member_type_id_idx" ON "public"."members"("member_type_id");

-- CreateIndex
CREATE INDEX "members_home_branch_id_status_idx" ON "public"."members"("home_branch_id", "status");

-- CreateIndex
CREATE INDEX "members_status_idx" ON "public"."members"("status");

-- CreateIndex
CREATE INDEX "members_deleted_at_idx" ON "public"."members"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "publishers_name_key" ON "public"."publishers"("name");

-- CreateIndex
CREATE INDEX "authors_sort_name_idx" ON "public"."authors"("sort_name");

-- CreateIndex
CREATE INDEX "authors_name_idx" ON "public"."authors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "public"."categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "public"."categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_position_idx" ON "public"."categories"("position");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "public"."tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn13_key" ON "public"."books"("isbn13");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn10_key" ON "public"."books"("isbn10");

-- CreateIndex
CREATE INDEX "books_title_idx" ON "public"."books"("title");

-- CreateIndex
CREATE INDEX "books_publisher_id_idx" ON "public"."books"("publisher_id");

-- CreateIndex
CREATE INDEX "books_publication_year_idx" ON "public"."books"("publication_year");

-- CreateIndex
CREATE INDEX "books_language_idx" ON "public"."books"("language");

-- CreateIndex
CREATE INDEX "books_archived_at_idx" ON "public"."books"("archived_at");

-- CreateIndex
CREATE INDEX "books_created_by_idx" ON "public"."books"("created_by");

-- CreateIndex
CREATE INDEX "books_call_number_idx" ON "public"."books"("call_number");

-- CreateIndex
CREATE INDEX "book_authors_author_id_idx" ON "public"."book_authors"("author_id");

-- CreateIndex
CREATE INDEX "book_categories_category_id_idx" ON "public"."book_categories"("category_id");

-- CreateIndex
CREATE INDEX "book_tags_tag_id_idx" ON "public"."book_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_accession_number_key" ON "public"."book_copies"("accession_number");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_barcode_key" ON "public"."book_copies"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_qr_token_key" ON "public"."book_copies"("qr_token");

-- CreateIndex
CREATE INDEX "book_copies_book_id_status_idx" ON "public"."book_copies"("book_id", "status");

-- CreateIndex
CREATE INDEX "book_copies_branch_id_status_idx" ON "public"."book_copies"("branch_id", "status");

-- CreateIndex
CREATE INDEX "book_copies_location_id_idx" ON "public"."book_copies"("location_id");

-- CreateIndex
CREATE INDEX "book_copies_shelf_id_idx" ON "public"."book_copies"("shelf_id");

-- CreateIndex
CREATE INDEX "book_copies_status_idx" ON "public"."book_copies"("status");

-- CreateIndex
CREATE INDEX "book_copies_removed_at_idx" ON "public"."book_copies"("removed_at");

-- CreateIndex
CREATE INDEX "copy_status_history_copy_id_changed_at_idx" ON "public"."copy_status_history"("copy_id", "changed_at");

-- CreateIndex
CREATE INDEX "loans_copy_id_status_idx" ON "public"."loans"("copy_id", "status");

-- CreateIndex
CREATE INDEX "loans_member_id_status_idx" ON "public"."loans"("member_id", "status");

-- CreateIndex
CREATE INDEX "loans_status_due_date_idx" ON "public"."loans"("status", "due_date");

-- CreateIndex
CREATE INDEX "loans_branch_id_status_idx" ON "public"."loans"("branch_id", "status");

-- CreateIndex
CREATE INDEX "loans_book_id_loaned_at_idx" ON "public"."loans"("book_id", "loaned_at");

-- CreateIndex
CREATE INDEX "loans_issued_by_idx" ON "public"."loans"("issued_by");

-- CreateIndex
CREATE INDEX "loans_member_id_loaned_at_idx" ON "public"."loans"("member_id", "loaned_at");

-- CreateIndex
CREATE INDEX "loan_status_history_loan_id_changed_at_idx" ON "public"."loan_status_history"("loan_id", "changed_at");

-- CreateIndex
CREATE INDEX "loan_renewals_loan_id_idx" ON "public"."loan_renewals"("loan_id");

-- CreateIndex
CREATE INDEX "loan_renewals_renewed_by_idx" ON "public"."loan_renewals"("renewed_by");

-- CreateIndex
CREATE UNIQUE INDEX "loan_renewals_loan_id_renewal_number_key" ON "public"."loan_renewals"("loan_id", "renewal_number");

-- CreateIndex
CREATE INDEX "reservations_book_id_status_position_idx" ON "public"."reservations"("book_id", "status", "position");

-- CreateIndex
CREATE INDEX "reservations_member_id_status_idx" ON "public"."reservations"("member_id", "status");

-- CreateIndex
CREATE INDEX "reservations_status_hold_expires_at_idx" ON "public"."reservations"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "reservations_branch_id_status_idx" ON "public"."reservations"("branch_id", "status");

-- CreateIndex
CREATE INDEX "reservations_fulfilled_loan_id_idx" ON "public"."reservations"("fulfilled_loan_id");

-- CreateIndex
CREATE UNIQUE INDEX "fines_reference_key" ON "public"."fines"("reference");

-- CreateIndex
CREATE INDEX "fines_member_id_status_idx" ON "public"."fines"("member_id", "status");

-- CreateIndex
CREATE INDEX "fines_status_assessed_at_idx" ON "public"."fines"("status", "assessed_at");

-- CreateIndex
CREATE INDEX "fines_type_idx" ON "public"."fines"("type");

-- CreateIndex
CREATE INDEX "fines_loan_id_idx" ON "public"."fines"("loan_id");

-- CreateIndex
CREATE UNIQUE INDEX "fine_payments_receipt_number_key" ON "public"."fine_payments"("receipt_number");

-- CreateIndex
CREATE INDEX "fine_payments_fine_id_paid_at_idx" ON "public"."fine_payments"("fine_id", "paid_at");

-- CreateIndex
CREATE INDEX "fine_payments_paid_at_idx" ON "public"."fine_payments"("paid_at");

-- CreateIndex
CREATE INDEX "fine_payments_received_by_idx" ON "public"."fine_payments"("received_by");

-- CreateIndex
CREATE INDEX "fine_payments_method_idx" ON "public"."fine_payments"("method");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "public"."notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_type_created_at_idx" ON "public"."notifications"("type", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "public"."audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "public"."audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "public"."audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "public"."audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "public"."settings"("key");

-- CreateIndex
CREATE INDEX "settings_category_idx" ON "public"."settings"("category");

-- CreateIndex
CREATE INDEX "digital_resources_book_id_is_active_idx" ON "public"."digital_resources"("book_id", "is_active");

-- CreateIndex
CREATE INDEX "digital_resources_access_level_idx" ON "public"."digital_resources"("access_level");

-- CreateIndex
CREATE INDEX "digital_loans_member_id_status_idx" ON "public"."digital_loans"("member_id", "status");

-- CreateIndex
CREATE INDEX "digital_loans_resource_id_status_idx" ON "public"."digital_loans"("resource_id", "status");

-- CreateIndex
CREATE INDEX "sync_operations_user_id_sync_status_idx" ON "public"."sync_operations"("user_id", "sync_status");

-- CreateIndex
CREATE INDEX "sync_operations_device_id_idx" ON "public"."sync_operations"("device_id");

-- CreateIndex
CREATE INDEX "sync_operations_sync_status_created_at_idx" ON "public"."sync_operations"("sync_status", "created_at");

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_primary_branch_id_fkey" FOREIGN KEY ("primary_branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_branches" ADD CONSTRAINT "user_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_branches" ADD CONSTRAINT "user_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_branches" ADD CONSTRAINT "user_branches_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branches" ADD CONSTRAINT "branches_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."locations" ADD CONSTRAINT "locations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shelves" ADD CONSTRAINT "shelves_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."members" ADD CONSTRAINT "members_member_type_id_fkey" FOREIGN KEY ("member_type_id") REFERENCES "public"."member_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."members" ADD CONSTRAINT "members_home_branch_id_fkey" FOREIGN KEY ("home_branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."books" ADD CONSTRAINT "books_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."books" ADD CONSTRAINT "books_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_authors" ADD CONSTRAINT "book_authors_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_authors" ADD CONSTRAINT "book_authors_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_categories" ADD CONSTRAINT "book_categories_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_categories" ADD CONSTRAINT "book_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_tags" ADD CONSTRAINT "book_tags_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_tags" ADD CONSTRAINT "book_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_copies" ADD CONSTRAINT "book_copies_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_copies" ADD CONSTRAINT "book_copies_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_copies" ADD CONSTRAINT "book_copies_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."book_copies" ADD CONSTRAINT "book_copies_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."copy_status_history" ADD CONSTRAINT "copy_status_history_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "public"."book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "public"."book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_member_type_id_fkey" FOREIGN KEY ("member_type_id") REFERENCES "public"."member_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan_status_history" ADD CONSTRAINT "loan_status_history_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan_renewals" ADD CONSTRAINT "loan_renewals_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan_renewals" ADD CONSTRAINT "loan_renewals_renewed_by_fkey" FOREIGN KEY ("renewed_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_fulfilled_loan_id_fkey" FOREIGN KEY ("fulfilled_loan_id") REFERENCES "public"."loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_waived_by_fkey" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fine_payments" ADD CONSTRAINT "fine_payments_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "public"."fines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fine_payments" ADD CONSTRAINT "fine_payments_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fine_payments" ADD CONSTRAINT "fine_payments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fine_payments" ADD CONSTRAINT "fine_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."digital_resources" ADD CONSTRAINT "digital_resources_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."digital_resources" ADD CONSTRAINT "digital_resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."digital_loans" ADD CONSTRAINT "digital_loans_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."digital_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."digital_loans" ADD CONSTRAINT "digital_loans_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

