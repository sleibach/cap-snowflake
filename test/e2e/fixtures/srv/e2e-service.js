const cds = require('@sap/cds');

module.exports = function () {
  const { Orders } = this.entities;

  this.on('submitOrder', async (req) => {
    const { book, quantity } = req.data;
    const qty = Number(quantity || 0);
    const escapedBook = String(book || '').replace(/'/g, "''");

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

    await db.run(`UPDATE CAP_E2E_DB.APP.CAP_E2E_BOOKS SET STOCK = 5 WHERE ID = '${escapedBook}'`);

    return SELECT.one.from(Orders).where({ book_ID: book }).orderBy({ ref: ['createdAt'], sort: 'desc' });
  });
};
