-- Migration: add Anbiyam + sacrament fields to students
-- Run this in the Supabase SQL editor (CLI is not linked to this project).
-- Safe to re-run: uses IF NOT EXISTS.

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS anbiyam_name             TEXT,
    ADD COLUMN IF NOT EXISTS received_first_communion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS received_confirmation    BOOLEAN NOT NULL DEFAULT FALSE;

