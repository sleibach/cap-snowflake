/**
 * Implementation for CatalogService
 */

module.exports = function() {
  const { Books, Orders } = this.entities;

  // Custom action: submit order
  this.on('submitOrder', async (req) => {
    const { book, quantity } = req.data;
    
    // Get book details
    const bookData = await SELECT.one.from(Books).where({ ID: book });
    
    if (!bookData) {
      return req.error(404, `Book ${book} not found`);
    }

    if (bookData.stock < quantity) {
      return req.error(400, `Insufficient stock. Available: ${bookData.stock}`);
    }

    // Calculate total
    const total = bookData.price * quantity;

    // Create order
    const order = await INSERT.into(Orders).entries({
      book_ID: book,
      quantity,
      buyer: req.user.id || 'anonymous',
      total
    });

    // Update stock
    await UPDATE(Books).set({ stock: bookData.stock - quantity }).where({ ID: book });

    return order;
  });

  // After READ of Books, calculate availability status
  this.after('READ', Books, (books) => {
    if (Array.isArray(books)) {
      books.forEach(book => {
        book.available = book.stock > 0;
      });
    } else if (books) {
      books.available = books.stock > 0;
    }
  });
};

