namespace Snowflake;

/** VECTOR column — maps to VECTOR(FLOAT, n) DDL */
annotation vector {
  dimensions : Integer;
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
