using bookshop from '../db/schema';

service CatalogService {
  @readonly entity Books as projection on bookshop.Books {
    *,
    author.name as authorName
  };

  @readonly entity Authors as projection on bookshop.Authors;

  entity Orders as projection on bookshop.Orders;

  action submitOrder(book: Books:ID, quantity: Integer) returns Orders;
}

