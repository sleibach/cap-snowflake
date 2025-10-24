namespace bookshop;

using { cuid, managed } from '@sap/cds/common';

entity Books : cuid, managed {
  title       : String(100) @mandatory;
  author      : Association to Authors;
  price       : Decimal(10, 2);
  stock       : Integer;
  description : LargeString;
}

entity Authors : cuid, managed {
  name    : String(100) @mandatory;
  country : String(2);
  books   : Association to many Books on books.author = $self;
}

entity Orders : cuid, managed {
  book     : Association to Books;
  quantity : Integer @mandatory;
  buyer    : String(100);
  total    : Decimal(10, 2);
}

