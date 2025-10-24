# CAP Snowflake Example Service

This is a sample CAP application demonstrating the Snowflake database adapter.

## Setup

1. **Configure Snowflake credentials** in `package.json` under `cds.requires.db.credentials`

2. **Set environment variables** for JWT authentication:
   ```bash
   export SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
   ...
   -----END PRIVATE KEY-----"
   export SNOWFLAKE_PASSPHRASE="your-passphrase"
   ```

3. **Create Snowflake tables** manually (DDL auto-generation coming soon):
   ```sql
   CREATE TABLE BOOKS (
     ID VARCHAR(36) PRIMARY KEY,
     TITLE VARCHAR(100) NOT NULL,
     AUTHOR_ID VARCHAR(36),
     PRICE NUMBER(10,2),
     STOCK NUMBER(38,0),
     DESCRIPTION TEXT,
     CREATEDAT TIMESTAMP_NTZ,
     CREATEDBY VARCHAR(100),
     MODIFIEDAT TIMESTAMP_NTZ,
     MODIFIEDBY VARCHAR(100)
   );

   CREATE TABLE AUTHORS (
     ID VARCHAR(36) PRIMARY KEY,
     NAME VARCHAR(100) NOT NULL,
     COUNTRY VARCHAR(2),
     CREATEDAT TIMESTAMP_NTZ,
     CREATEDBY VARCHAR(100),
     MODIFIEDAT TIMESTAMP_NTZ,
     MODIFIEDBY VARCHAR(100)
   );

   CREATE TABLE ORDERS (
     ID VARCHAR(36) PRIMARY KEY,
     BOOK_ID VARCHAR(36),
     QUANTITY NUMBER(38,0) NOT NULL,
     BUYER VARCHAR(100),
     TOTAL NUMBER(10,2),
     CREATEDAT TIMESTAMP_NTZ,
     CREATEDBY VARCHAR(100),
     MODIFIEDAT TIMESTAMP_NTZ,
     MODIFIEDBY VARCHAR(100)
   );
   ```

4. **Install dependencies**:
   ```bash
   npm install
   ```

5. **Run the service**:
   ```bash
   npm start
   ```

## Testing OData Queries

Once the service is running, try these OData queries:

### Get all books
```
GET http://localhost:4004/catalog/Books
```

### Get books with $select
```
GET http://localhost:4004/catalog/Books?$select=title,price
```

### Filter books by price
```
GET http://localhost:4004/catalog/Books?$filter=price lt 20
```

### Order books
```
GET http://localhost:4004/catalog/Books?$orderby=title asc
```

### Pagination
```
GET http://localhost:4004/catalog/Books?$top=10&$skip=0
```

### Count
```
GET http://localhost:4004/catalog/Books?$count=true
```

### Submit an order (action)
```
POST http://localhost:4004/catalog/submitOrder
Content-Type: application/json

{
  "book": "book-id-here",
  "quantity": 2
}
```

