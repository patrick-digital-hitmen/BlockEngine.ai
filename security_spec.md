# Security Specification - WP Content Architect

## Data Invariants
1. A block cannot exist without a valid project ID.
2. A project must have an ownerId matching the authenticated user.
3. Only the owner of a project can read/write its blocks.

## The Dirty Dozen Payloads
1. **Unauthorized Project Creation**: Creating a project with a different `ownerId`.
2. **Unauthorized Project Read**: Reading someone else's project.
3. **Unauthorized Project Update**: Changing the `ownerId` of an existing project.
4. **Orphaned Block Creation**: Creating a block with a non-existent `projectId`.
5. **Cross-Project Block Injection**: Creating a block for a project you don't own.
6. **Malicious ID Poisoning**: Using a 2KB string as a `projectId`.
7. **Type Mismatch Update**: Setting `order` to a string instead of an integer.
8. **Shadow Field Injection**: Adding `isVerified: true` to a Project.
9. **Blanket Read Attempt**: Listing all projects in the database.
10. **State Shortcut**: (N/A for this app yet).
11. **Timestamp Spoofing**: Sending a `createdAt` from 1999.
12. **Block Corruption**: Updating a block's `projectId` to point to a different project.

## Test Runner (Logic)
The rules will prevent these by:
- Checking `request.auth.uid == resource.data.ownerId` or `request.auth.uid == incoming().ownerId`.
- Validating schema in `isValidProject` and `isValidBlock`.
- Enforcing `affectedKeys().hasOnly()`.
- Enforcing `request.time` for timestamps.
