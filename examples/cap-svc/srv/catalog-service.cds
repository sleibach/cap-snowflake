using bookshop from '../db/schema';

/**
 * Public read/write catalog.
 *
 * No .js handler file needed — CAP automatically handles all standard
 * CRUD operations for service projections backed by a database service.
 */
service CatalogService {

  @readonly
  entity Books as projection on bookshop.Books {
    *,
    author.name as authorName
  };

  @readonly
  entity Authors as projection on bookshop.Authors;

  entity Orders as projection on bookshop.Orders;
}
