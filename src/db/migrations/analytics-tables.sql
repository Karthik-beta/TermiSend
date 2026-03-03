-- ============================================================================
-- Migration: Add Analytics Tables
-- Version: 1.0.0
-- Created: 2026-03-03
-- Description: Creates analytics tables for event tracking and metrics
-- ============================================================================

-- This migration adds the new analytics tables without modifying existing 
-- business tables. Analytics data is kept isolated from business data.

-- ============================================================================
-- 1. Analytics Event Store
-- ============================================================================

-- General event store for all domain events
-- Stores raw events with full payload for flexible querying
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  event_id VARCHAR(100) NOT NULL UNIQUE,
  correlation_id VARCHAR(100),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  send_log_id UUID REFERENCES send_logs(id) ON DELETE SET NULL,
  campaign_id UUID,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_contact_id ON analytics_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_correlation_id ON analytics_events(correlation_id);

-- ============================================================================
-- 2. Contact Verification Metrics
-- ============================================================================

-- Daily aggregated verification metrics
-- Pre-computed for fast dashboard queries
CREATE TABLE IF NOT EXISTS verification_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  total_verified INTEGER NOT NULL DEFAULT 0,
  valid_emails INTEGER NOT NULL DEFAULT 0,
  invalid_emails INTEGER NOT NULL DEFAULT 0,
  unknown_emails INTEGER NOT NULL DEFAULT 0,
  average_response_time_ms DECIMAL(10,2),
  api_calls INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date)
);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_verification_metrics_date ON verification_metrics(date);

-- ============================================================================
-- 3. Email Send Outcome Metrics
-- ============================================================================

-- Daily aggregated send outcome metrics
-- Tracks success/failure rates per campaign
CREATE TABLE IF NOT EXISTS send_outcome_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  campaign_id UUID,
  total_requested INTEGER NOT NULL DEFAULT 0,
  successfully_sent INTEGER NOT NULL DEFAULT 0,
  failed_sends INTEGER NOT NULL DEFAULT 0,
  skipped_sends INTEGER NOT NULL DEFAULT 0,
  average_send_time_ms DECIMAL(10,2),
  ses_api_calls INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, campaign_id)
);

-- Index for date and campaign queries
CREATE INDEX IF NOT EXISTS idx_send_outcome_metrics_date ON send_outcome_metrics(date);
CREATE INDEX IF NOT EXISTS idx_send_outcome_metrics_campaign_id ON send_outcome_metrics(campaign_id);

-- ============================================================================
-- 4. SES API Metrics
-- ============================================================================

-- Daily aggregated SES API call metrics
-- Tracks API performance and error rates per endpoint
CREATE TABLE IF NOT EXISTS ses_api_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  api_endpoint VARCHAR(50) NOT NULL,
  total_calls INTEGER NOT NULL DEFAULT 0,
  successful_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0,
  average_response_time_ms DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, api_endpoint)
);

-- Index for date and endpoint queries
CREATE INDEX IF NOT EXISTS idx_ses_api_metrics_date ON ses_api_metrics(date);
CREATE INDEX IF NOT EXISTS idx_ses_api_metrics_endpoint ON ses_api_metrics(api_endpoint);

-- ============================================================================
-- 5. Throttling Metrics
-- ============================================================================

-- Daily aggregated throttling metrics
-- Tracks rate limiting impact and quota check outcomes
CREATE TABLE IF NOT EXISTS throttling_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  total_delays INTEGER NOT NULL DEFAULT 0,
  total_delay_time_ms BIGINT NOT NULL DEFAULT 0,
  average_delay_ms DECIMAL(10,2),
  quota_checks_passed INTEGER NOT NULL DEFAULT 0,
  quota_checks_failed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date)
);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_throttling_metrics_date ON throttling_metrics(date);

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- 
-- These tables are designed to be written to via the event persistence layer
-- and read via analytics queries. They are isolated from business tables to:
-- 
-- 1. Prevent analytics failures from affecting business operations
-- 2. Allow for independent scaling and optimization
-- 3. Enable future data retention policies without affecting business data
-- 
-- All tables use ON DELETE SET NULL for foreign keys to preserve analytics
-- history even when business records are deleted.
-- 
-- The UNIQUE constraints on date-based metrics tables enable upsert operations
-- for efficient daily aggregation.
