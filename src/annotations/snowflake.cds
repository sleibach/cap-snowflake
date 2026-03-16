namespace Snowflake;

/**
 * Optional override for a cds.Vector element.
 * Use cds.Vector(n) as the element type — that already maps to VECTOR(FLOAT, n).
 * This annotation is only needed to change the default similarity function
 * used by vectorSearch, or to override the dimension count.
 */
annotation vector {
  dimensions : Integer;  // overrides the dimension from Vector(n); default 1536
  similarity : String enum { COSINE; DOT_PRODUCT; EUCLIDEAN; } default 'COSINE';
}

/** CLUSTER BY column list */
annotation clustering : many String;

/** TIME TRAVEL retention in days (0 = off, 1–90) */
annotation dataRetentionDays : Integer;

/** ADD SEARCH OPTIMIZATION */
annotation searchOptimized : Boolean;

/** Column-level masking policy name */
annotation maskingPolicy : String;

/** Entity-level row access policy */
annotation rowAccessPolicy {
  policy : String;
  on     : many String;
}

/** Object or column tags */
annotation tags : many { key : String; value : String; }

/** Mark element as VARIANT — enables colon-path filter syntax */
annotation variant : Boolean;

/** External table */
annotation external {
  stage      : String;
  fileFormat : String;
  pattern    : String;
}
