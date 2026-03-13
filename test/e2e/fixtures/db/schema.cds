namespace cap_e2e;
using { cuid, managed, temporal } from '@sap/cds/common';

entity Authors : cuid, managed {
  name    : String(100) @mandatory;
  country : String(2);
  books   : Association to many Books on books.author = $self;
}

entity Books : cuid, managed {
  title       : String(120) @mandatory;
  author      : Association to Authors;
  price       : Decimal(10,2);
  stock       : Integer;
  description : LargeString;
}

entity Orders : cuid, managed {
  book     : Association to Books;
  quantity : Integer @mandatory;
  buyer    : String(100);
  total    : Decimal(10,2);
}

entity LocalizedBooks : cuid, managed {
  title       : localized String(120);
  description : localized String;
}

entity WorkAssignments : temporal {
  key ID         : UUID;
  employee       : String(100);
  role           : String(100);
  department     : String(100);
}

entity Catalogs : cuid, managed {
  name  : String(100) @mandatory;
  items : Composition of many CatalogItems on items.catalog = $self;
}

entity CatalogItems : cuid, managed {
  catalog : Association to Catalogs;
  title   : String(100) @mandatory;
  price   : Decimal(10,2);
}

@Analytics.dataCategory: #FACT
entity SalesFacts : cuid, managed {
  book     : Association to Books;
  region   : String(50);
  channel  : String(50);
  amount   : Decimal(10,2) @Aggregation.default: #SUM;
  units    : Integer @Aggregation.default: #SUM;
}
