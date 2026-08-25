-- ============================================================================
-- 0016_venue_type.sql
--
-- Three fields the reference designs need that 0015 didn't have. Run AFTER
-- 0015. Additive and idempotent — no existing column or policy changes.
--
-- 1. venue_types — the "Banquet hall, wedding garden, wedding resorts" line
--    under each category on the browse page, and a filter in its own right.
--    An ARRAY, not a single column: a hill resort with a banquet hall and a
--    lawn is all three at once, and forcing a choice between them makes the
--    property invisible to two of the three filters a couple might use.
--
-- 2. hotel_star_rating — "Wildflower Hall is a 5 star resort". Deliberately
--    NOT the same field as `rating`: one is the property's official hotel
--    classification, the other is what couples scored it. Merging them would
--    let a 5-star property display five stars of customer satisfaction it
--    never earned, which is precisely the kind of fabricated social proof
--    0015's guard trigger exists to prevent.
--
-- 3. map_lat / map_lng already existed in 0015 but had no editor control —
--    fixed on the UI side, nothing needed here.
-- ============================================================================

alter table vendor_listings
  add column if not exists venue_types text[] not null default '{}'::text[];

alter table vendor_listings
  add column if not exists hotel_star_rating smallint;

alter table vendor_listings drop constraint if exists vendor_listings_star_range;
alter table vendor_listings add constraint vendor_listings_star_range
  check (hotel_star_rating is null or hotel_star_rating between 1 and 7);

-- Controlled vocabulary, same reasoning as `badges`: a typo ("banquet_halls")
-- creates a value no filter will ever match, and nobody notices until a
-- venue mysteriously stops appearing in its own category.
alter table vendor_listings drop constraint if exists vendor_listings_venue_types_valid;
alter table vendor_listings add constraint vendor_listings_venue_types_valid
  check (venue_types <@ array[
    'banquet_hall', 'wedding_garden', 'wedding_resort', 'hotel', 'farmhouse',
    'lawn', 'destination', 'heritage', 'rooftop', 'convention_centre'
  ]::text[]);

-- Same partial-index treatment as every other browse filter in 0015: the
-- public grid only ever looks at published rows.
create index if not exists vendor_listings_venue_types_idx
  on vendor_listings using gin (venue_types)
  where status = 'published';
