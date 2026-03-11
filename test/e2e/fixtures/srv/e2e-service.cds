using {
  Authors as DBAuthors,
  Books as DBBooks,
  Orders as DBOrders,
  LocalizedBooks as DBLocalizedBooks,
  WorkAssignments as DBWorkAssignments
} from '../db/schema';

service E2ETestService {
  @readonly entity Authors as projection on DBAuthors;
  entity Books as projection on DBBooks;
  entity Orders as projection on DBOrders;
  entity LocalizedBooks as projection on DBLocalizedBooks;
  @readonly entity WorkAssignments as projection on DBWorkAssignments;

  action submitOrder(book: UUID, quantity: Integer) returns Orders;
}
