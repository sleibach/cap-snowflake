# Temporal Data Support

Complete guide for application-time period tables (time slices) with the Snowflake adapter.

## Overview

The Snowflake adapter implements CAP's temporal data pattern, enabling historical tracking and time-travel queries. This follows the same conventions as @cap-js/postgres, @cap-js/sqlite, and @cap-js/hana.

## Basic Usage

### Define Temporal Entity

**Option 1: Using temporal aspect (recommended)**:

```cds
using { temporal } from '@sap/cds/common';

entity WorkAssignments : temporal {
  key ID : UUID;
  employee : Association to Employees;
  role : String(50);
  department : Association to Departments;
}
```

**Option 2: Explicit annotations**:

```cds
entity WorkAssignments {
  key ID : UUID;
  employee : Association to Employees;
  role : String(50);
  validFrom : Timestamp @cds.valid.from;
  validTo : Timestamp @cds.valid.to;
}
```

Both expand to:
```cds
entity WorkAssignments {
  key ID : UUID;
  employee : Association to Employees;
  role : String(50);
  validFrom : Timestamp;
  validTo : Timestamp;
}
```

### Generated Database Schema

**Temporal Table** with composite primary key:

```sql
CREATE TABLE WORKASSIGNMENTS (
  ID VARCHAR(36) NOT NULL,
  employee_ID VARCHAR(36),
  role VARCHAR(50),
  department_ID VARCHAR(36),
  validFrom TIMESTAMP_NTZ NOT NULL,
  validTo TIMESTAMP_NTZ NOT NULL,
  PRIMARY KEY (ID, validFrom)  -- Composite key for time slices
);
```

**Current View** (optional, for convenience):

```sql
CREATE VIEW CURRENT_WORKASSIGNMENTS AS
SELECT * FROM WORKASSIGNMENTS
WHERE validFrom <= CURRENT_TIMESTAMP()
  AND CURRENT_TIMESTAMP() < validTo;
```

## Time Slice Semantics

### Validity Period

Each record represents a time slice with half-open interval:
- **validFrom** (inclusive): Start of validity
- **validTo** (exclusive): End of validity

```
Timeline: |----[validFrom]=========(validTo)----|
          ^    ^                   ^            ^
        Past  Start               End         Future
              (inclusive)         (exclusive)
```

### Example Data

```sql
-- Employee worked in Sales from Jan to Jun 2024
INSERT INTO WORKASSIGNMENTS VALUES (
  '1', 'emp-001', 'Sales Rep', 'dept-sales',
  '2024-01-01', '2024-06-01'
);

-- Then moved to Marketing from Jun onwards
INSERT INTO WORKASSIGNMENTS VALUES (
  '1', 'emp-001', 'Marketing Manager', 'dept-marketing',
  '2024-06-01', '9999-12-31'
);
```

## Querying Temporal Data

### As-Of-Now Query (Current Time Slice)

```javascript
// Returns current assignment
const current = await SELECT.from('WorkAssignments')
  .where({ ID: '1' });

// Generated SQL includes automatic temporal filtering
// WHERE ID = ? AND validFrom <= CURRENT_TIMESTAMP() AND CURRENT_TIMESTAMP() < validTo
```

### Point-In-Time Query (Historical)

```javascript
// What was the assignment on March 15, 2024?
const historical = await SELECT.from('WorkAssignments')
  .where({ 
    ID: '1',
    validFrom: { '<=': '2024-03-15' },
    validTo: { '>': '2024-03-15' }
  });

// Returns: Sales Rep (active during March 2024)
```

### Time Range Query

```javascript
// Get all assignments during Q1 2024
const q1 = await SELECT.from('WorkAssignments')
  .where({
    ID: '1',
    validFrom: { '<': '2024-04-01' },
    validTo: { '>': '2024-01-01' }
  });

// Returns all time slices that overlap with Q1
```

### Full History Query

```javascript
// Get complete history for an entity
const history = await SELECT.from('WorkAssignments')
  .where({ ID: '1' })
  .orderBy('validFrom');

// Returns all time slices in chronological order
```

## Updating Temporal Data

### Creating New Time Slice

CAP handles temporal updates by creating new time slices:

```javascript
// Update assignment (creates new time slice, closes old one)
await UPDATE('WorkAssignments')
  .set({ role: 'Senior Manager' })
  .where({ ID: '1' });
```

**Behind the scenes**:
1. Current slice: Set validTo = CURRENT_TIMESTAMP()
2. New slice: INSERT with validFrom = CURRENT_TIMESTAMP(), validTo = '9999-12-31'

### Manual Time Slice Creation

```javascript
// Create explicit time slice
await INSERT.into('WorkAssignments').entries({
  ID: '1',
  employee_ID: 'emp-001',
  role: 'Director',
  validFrom: '2025-01-01',
  validTo: '9999-12-31'
});
```

### Correcting Historical Data

```javascript
// Fix historical record
await UPDATE('WorkAssignments')
  .set({ role: 'Corrected Title' })
  .where({ 
    ID: '1',
    validFrom: '2024-01-01' 
  });
```

## Deleting Temporal Data

### Soft Delete (Close Time Slice)

```javascript
// Close current time slice (soft delete)
await UPDATE('WorkAssignments')
  .set({ validTo: new Date() })
  .where({ ID: '1' });
```

### Hard Delete (Remove History)

```javascript
// Delete all time slices
await DELETE.from('WorkAssignments')
  .where({ ID: '1' });

// Delete specific time slice
await DELETE.from('WorkAssignments')
  .where({ ID: '1', validFrom: '2024-01-01' });
```

## Temporal Associations

### Referencing Temporal Entities

```cds
entity EmployeeNotes {
  key ID : UUID;
  workAssignment : Association to WorkAssignments { ID, validFrom };
  note : String;
}
```

The association references a specific time slice using both ID and validFrom.

### Transitive Temporal Data

When both entities are temporal:

```cds
entity WorkAssignments : temporal {
  key ID : UUID;
  dept : Association to Departments;
  
  // Constrained association to match time slices
  deptAtStart : Association to Departments 
    on deptAtStart.ID = dept.ID
    and deptAtStart.validFrom <= validFrom
    and validFrom < deptAtStart.validTo;
}

entity Departments : temporal {
  key ID : UUID;
  name : String;
}
```

This prevents redundant rows when expanding across multiple temporal entities.

## Best Practices

### 1. Use Infinite Future for Open-Ended Periods

```javascript
await INSERT.into('WorkAssignments').entries({
  ID: '1',
  role: 'Manager',
  validFrom: new Date(),
  validTo: '9999-12-31T23:59:59Z'  // Infinite future
});
```

### 2. Avoid Gaps in Timeline

Ensure continuous coverage:

```sql
-- Good: Continuous timeline
validFrom='2024-01-01', validTo='2024-06-01'
validFrom='2024-06-01', validTo='9999-12-31'

-- Bad: Gap between periods
validFrom='2024-01-01', validTo='2024-05-31'  -- Gap!
validFrom='2024-06-01', validTo='9999-12-31'
```

### 3. Use Timestamps for Precision

```cds
entity WorkAssignments : temporal {
  // Prefer Timestamp over Date for precision
  validFrom : Timestamp @cds.valid.from;
  validTo : Timestamp @cds.valid.to;
}
```

### 4. Index Temporal Queries

```sql
-- Essential indexes
CREATE INDEX idx_workassignments_valid 
  ON WORKASSIGNMENTS(ID, validFrom, validTo);

CREATE INDEX idx_workassignments_current 
  ON WORKASSIGNMENTS(validFrom, validTo) 
  WHERE validTo > CURRENT_TIMESTAMP();
```

## Common Patterns

### Effective Dating

```javascript
// Create future-dated assignment
await INSERT.into('WorkAssignments').entries({
  ID: '1',
  role: 'VP of Sales',
  validFrom: '2025-01-01',  // Future effective date
  validTo: '9999-12-31'
});
```

### Retroactive Changes

```javascript
// Add historical record
await INSERT.into('WorkAssignments').entries({
  ID: '1',
  role: 'Intern',
  validFrom: '2023-01-01',
  validTo: '2023-12-31'
});
```

### Versioned Configuration

```cds
// Temporal configuration table
entity PricingRules : temporal {
  key ruleID : String;
  multiplier : Decimal;
  conditions : String;
}
```

Query returns pricing rule valid at any point in time.

## Snowflake-Specific Features

### Time Travel (Native Snowflake)

In addition to application-time (CAP temporal), Snowflake offers system-time:

```sql
-- Query table as it existed 1 hour ago (system-time)
SELECT * FROM WORKASSIGNMENTS 
  AT(OFFSET => -3600);

-- Query as of specific timestamp
SELECT * FROM WORKASSIGNMENTS 
  AT(TIMESTAMP => '2024-01-15 10:00:00'::timestamp);
```

**Note**: This is separate from CAP's application-time temporal support.

### Clustering for Performance

```sql
-- Cluster temporal table by time fields
ALTER TABLE WORKASSIGNMENTS 
  CLUSTER BY (validFrom, validTo);
```

## Troubleshooting

### "Duplicate key violation"

**Cause**: Attempting to insert overlapping time slices

**Solution**: Ensure non-overlapping periods:

```javascript
// Before inserting, check for conflicts
const existing = await SELECT.from('WorkAssignments')
  .where({
    ID: '1',
    validFrom: { '<': newValidTo },
    validTo: { '>': newValidFrom }
  });

if (existing.length > 0) {
  throw new Error('Overlapping time period');
}
```

### "No current record found"

**Cause**: All time slices are in the past or future

**Solution**: Check validFrom/validTo values:

```sql
SELECT ID, validFrom, validTo, CURRENT_TIMESTAMP()
FROM WORKASSIGNMENTS
WHERE ID = '1';
```

### "Query returns multiple rows"

**Cause**: Query doesn't filter by time, returns all slices

**Solution**: Add temporal WHERE clause:

```javascript
// Add temporal filtering
const current = await SELECT.one.from('WorkAssignments')
  .where({ 
    ID: '1',
    validFrom: { '<=': new Date() },
    validTo: { '>': new Date() }
  });
```

## Example Application

```cds
// db/schema.cds
using { temporal, cuid } from '@sap/cds/common';

entity Employees : cuid {
  name : String(100);
  assignments : Composition of many WorkAssignments on assignments.employee = $self;
}

entity WorkAssignments : temporal {
  key ID : UUID;
  employee : Association to Employees;
  role : String(50);
  salary : Decimal(10,2);
}

entity Departments : temporal {
  key ID : UUID;
  name : String(100);
  budget : Decimal(15,2);
}

// srv/hr-service.cds
using { db } from '../db/schema';

service HRService {
  entity Employees as projection on db.Employees;
  entity WorkAssignments as projection on db.WorkAssignments;
  entity Departments as projection on db.Departments;
  
  // Get current assignments
  entity CurrentAssignments as SELECT from db.WorkAssignments
    where validFrom <= CURRENT_TIMESTAMP() 
      and CURRENT_TIMESTAMP() < validTo;
}
```

## See Also

- [CAP Temporal Data Guide](https://cap.cloud.sap/docs/guides/temporal-data)
- [Annotations Support](./ANNOTATIONS_SUPPORT.md)
- [Type Mappings](../README.md#type-mappings)

---

**Version**: 1.0.0  
**Status**: Fully Implemented  
**Last Updated**: October 24, 2024


