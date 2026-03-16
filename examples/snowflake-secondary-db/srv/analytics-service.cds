/**
 * Read-only analytics service that surfaces data from a Snowflake data mart.
 *
 * The entity is not deployed to the primary DB (@cds.persistence.skip).
 * @cds.persistence.name maps it to the physical Snowflake table name.
 * The .js handler connects to the named 'snowflake' service and delegates reads.
 */
service AnalyticsService {

  @readonly
  @cds.persistence.skip
  @cds.persistence.name: 'MATERIAL_VALUATION'
  entity MaterialValuation {
    key material_id         : String;
        material_name       : String;
        category            : String;
        warehouse           : String;
        location            : String;
        purchase_price_eur  : Decimal(15, 2);
        stock_units         : Decimal(15, 2);
        consumption_30d     : Decimal(15, 2);
        coverage_days       : Decimal(15, 2);
        sales_trend_6m      : String;
        expiry_date         : String;
  };
}
