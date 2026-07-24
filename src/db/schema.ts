import { pgTable, text, integer, jsonb, numeric } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  uid: text("uid").primaryKey(), // Auth UID (Supabase or sandbox)
  email: text("email").notNull(),
  createdAt: text("created_at").notNull(),
});

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.uid, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  avatarColor: text("avatar_color").notNull(),
  createdAt: text("created_at").notNull(),
});

export const items = pgTable("items", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.uid, { onDelete: "cascade" })
    .notNull(),
  profileId: text("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  imageUrl: text("image_url").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull(),
  colors: jsonb("colors").notNull(),
  season: jsonb("season").notNull(),
  occasion: jsonb("occasion").notNull(),
  customZoom: numeric("custom_zoom").default("1.0"),
  customOffsetY: integer("custom_offset_y").default(0),
  createdAt: text("created_at").notNull(),
  timesWorn: integer("times_worn").default(0).notNull(),
  lastWornAt: text("last_worn_at"),
});

export const outfits = pgTable("outfits", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.uid, { onDelete: "cascade" })
    .notNull(),
  profileId: text("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  itemIds: jsonb("item_ids").notNull(), // string[]
  occasion: text("occasion").notNull(),
  createdAt: text("created_at").notNull(),
  timesWorn: integer("times_worn").default(0).notNull(),
  lastWornAt: text("last_worn_at"),
});
