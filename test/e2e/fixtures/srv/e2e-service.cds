using {
  cap_e2e as db
} from '../db/schema';

service E2ETestService {
  @readonly entity Authors as projection on db.Authors;
  @odata.draft.enabled
  entity Books as projection on db.Books;

  action TestAction();

  entity Orders as projection on db.Orders;
  entity LocalizedBooks as projection on db.LocalizedBooks;
  @readonly entity WorkAssignments as projection on db.WorkAssignments;


  action submitOrder(book: UUID, quantity: Integer) returns Orders;

  entity Catalogs     as projection on db.Catalogs;
  entity CatalogItems as projection on db.CatalogItems;
}
