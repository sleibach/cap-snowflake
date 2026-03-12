const cds = require('@sap/cds');

module.exports = function () {
  const { Orders, Books } = this.entities;

  this.on('submitOrder', async (req) => {
    const { book, quantity } = req.data;
    const qty = Number(quantity || 0);

    if (!book || qty <= 0) {
      return req.error(400, 'book and positive quantity are required');
    }

    const db = await cds.connect.to('db');
    const total = 0;
    await INSERT.into(Orders).entries({
      ID: cds.utils.uuid(),
      book_ID: book,
      quantity: qty,
      buyer: req.user?.id || 'e2e-user',
      total
    });

    await db.run('UPDATE CAP_E2E_DB.APP.CAP_E2E_BOOKS SET STOCK = 5 WHERE ID = ?', [book]);

    return SELECT.one.from(Orders).where({ book_ID: book }).orderBy({ ref: ['createdAt'], sort: 'desc' });
  });

  this.on('TestAction', async (req) => {
    const query = SELECT.from(Books).where`stock = 3` // show direct CQL query generation
    const books = await query;
    req.info('TestAction executed', JSON.stringify(books, null, 2));
  });
};
