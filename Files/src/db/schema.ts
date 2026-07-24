import { pgTable, text, integer, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  uid: text("uid").primaryKey(), // Firebase Auth UID
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
  colors: jsonb("colors").notNull(), // string[]
  season: jsonb("season").notNull(), // string[]
  occasion: jsonb("occasion").notNull(), // string[]
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
