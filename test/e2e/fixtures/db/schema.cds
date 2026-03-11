using { cuid, managed, temporal } from '@sap/cds/common';

@cds.persistence.name: 'CAP_E2E_AUTHORS'
entity Authors : cuid, managed {
  name    : String(100) @mandatory;
  country : String(2);
  books   : Association to many Books on books.author = $self;
}

@cds.persistence.name: 'CAP_E2E_BOOKS'
entity Books : cuid, managed {
  title       : String(120) @mandatory;
  author      : Association to Authors;
  price       : Decimal(10,2);
  stock       : Integer;
  description : LargeString;
}

@cds.persistence.name: 'CAP_E2E_ORDERS'
entity Orders : cuid, managed {
  book     : Association to Books;
  quantity : Integer @mandatory;
  buyer    : String(100);
  total    : Decimal(10,2);
}

@cds.persistence.name: 'CAP_E2E_LOCALIZED_BOOKS'
entity LocalizedBooks : cuid, managed {
  title       : localized String(120);
  description : localized String;
}

@cds.persistence.name: 'CAP_E2E_WORK_ASSIGNMENTS'
entity WorkAssignments : temporal {
  key ID         : UUID;
  employee       : String(100);
  role           : String(100);
  department     : String(100);
}
