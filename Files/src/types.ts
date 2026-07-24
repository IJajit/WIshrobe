export interface Profile {
  id: string;
  name: string;
  avatarColor: string; // Tailwind color class, e.g., 'bg-indigo-500' or hex
  createdAt: string;
}

export interface ClothingItem {
  id: string;
  imageUrl: string;
  category: "Tops" | "Bottoms" | "Skirts" | "Dresses" | "Full body & sets" | "Outerwear" | "Shoes" | "Accessories";
  subcategory: string;
  colors: string[];
  season: ("Spring" | "Summer" | "Autumn" | "Winter")[];
  occasion: string[]; // occasional or weather suitability tags
  createdAt: string;
  timesWorn: number;
  lastWornAt: string | null;
}

export interface Outfit {
  id: string;
  name: string;
  itemIds: string[];
  occasion: string;
  createdAt: string;
  timesWorn: number;
  lastWornAt: string | null;
}

export interface WearRecord {
  id: string;
  recordId: string; // ID of the item or outfit
  type: "item" | "outfit";
  wornAt: string;
}
