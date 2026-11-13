# Security Specification — FieldSnap Drive

## 1. Data Invariants
1. **Authentication & Email Verification**: All Firestore operations require an authenticated, email-verified user (`request.auth != null && request.auth.token.email_verified == true`).
2. **Managed User Isolation (PII & Credentials Protection)**: `managed_users` contains usernames, passwords, and emails. Only the Bootstrapped Admin (`mamangidz@gmail.com`) or the specific user whose verified email matches `resource.data.googleEmail` can read their record. Non-admins can never list or modify `managed_users`.
3. **Photo Submission Ownership & Location-Scoped Viewing**:
   - On creation, `uploadedByUid` must equal `request.auth.uid`, `validationStatus` must start at `'pending'`, and `validationNote`, `validatedBy`, `validatedAt` must be empty strings.
   - Viewers can only `get` or `list` `photo_submissions` where their verified email is explicitly included in `resource.data.viewerEmails` (scoped to their assigned location).
   - Field Users can only `get` or `list` their own submissions (`resource.data.uploadedByUid == request.auth.uid`).
   - Only Admins (`isBootstrappedAdmin()` or verified email in `existing().adminEmails`) can update `validationStatus` (`approved` / `rejected`) and `validationNote`.
4. **Immutable Fields & Temporal Integrity**: `createdAt`, `uploadedByUid`, and `ownerUid` cannot be changed after creation. `createdAt` and `updatedAt` must match `request.time`.
5. **Terminal State Locking**: Once `validationStatus` transitions from `'pending'` to `'approved'` or `'rejected'`, non-bootstrapped users cannot modify it again.

## 2. Dirty Dozen Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. **Unauthenticated Read**: Read `/photo_submissions` with `request.auth == null`.
2. **Unverified Email Spoof**: Write `/managed_users/u1` with `email: "mamangidz@gmail.com"` and `email_verified: false`.
3. **Privilege Escalation (Create User as Non-Admin)**: Authenticated non-admin tries to create `/managed_users/hacker` with `role: "admin"`.
4. **PII / Credential Scrape**: Non-admin executes `list` on `/managed_users` without matching `googleEmail`.
5. **Cross-Location Viewer Scrape**: Viewer from Bandung (`budi@gmail.com`) tries to `get` a Jakarta `photo_submission` where `budi@gmail.com` is not in `viewerEmails`.
6. **Self-Validation Bypass**: Field user creates a `photo_submission` with `validationStatus: "approved"` directly on create.
7. **Identity Spoofing on Upload**: Field user creates a `photo_submission` with `uploadedByUid: "another_uid"`.
8. **Shadow Field Injection**: User includes an unexpected ghost field `isSuperAdmin: true` in `photo_submissions` create payload.
9. **Path ID Poisoning**: Client attempts to create `/photo_submissions/../../evil_id` or a 1.5KB junk ID string.
10. **Immutable Field Tampering**: User attempts to update `uploadedByUid` or `createdAt` on an existing submission.
11. **Timestamp Forgery**: Client attempts to create a record with a backdated `createdAt` instead of `request.time`.
12. **Out-of-Bounds Coordinate / String Exhaustion**: Client submits `latitude: 999` or a 50KB string in `notes`.
