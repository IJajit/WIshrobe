import React, { useState, useEffect } from "react";
import { Profile } from "../types";
import { Users, Plus, Check, ChevronDown, UserPlus, X, Trash2, Edit2 } from "lucide-react";

interface ProfileSwitcherProps {
  userId: string;
  activeProfile: Profile | null;
  onProfileChange: (profile: Profile) => void;
}

const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-blue-500",
  "bg-teal-500",
];

export default function ProfileSwitcher({
  userId,
  activeProfile,
  onProfileChange,
}: ProfileSwitcherProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [isLoading, setIsLoading] = useState(false);

  // Load profiles from Cloud SQL
  useEffect(() => {
    if (!userId) return;

    const loadProfiles = async () => {
      try {
        const res = await fetch("/api/profiles", {
          headers: {
            "X-User-Uid": userId,
          },
        });
        if (!res.ok) throw new Error(await res.text());
        const list: Profile[] = await res.json();

        if (list.length === 0) {
          // Seed default Sarah & Alex profiles in PostgreSQL
          setIsLoading(true);
          const default1 = {
            id: `p-${Date.now()}-1`,
            name: "Sarah",
            avatarColor: "bg-purple-500",
            createdAt: new Date().toISOString(),
          };
          const default2 = {
            id: `p-${Date.now()}-2`,
            name: "Alex",
            avatarColor: "bg-teal-500",
            createdAt: new Date().toISOString(),
          };

          // Post both profiles
          await fetch("/api/profiles", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-Uid": userId,
            },
            body: JSON.stringify(default1),
          });

          await fetch("/api/profiles", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-Uid": userId,
            },
            body: JSON.stringify(default2),
          });

          const seeded = [default1, default2];
          setProfiles(seeded);
          if (!activeProfile) {
            onProfileChange(seeded[0]);
          }
        } else {
          setProfiles(list);
          const savedProfileId = localStorage.getItem(`active_profile_${userId}`);
          const matched = list.find((p) => p.id === savedProfileId);
          if (matched) {
            onProfileChange(matched);
          } else {
            const sarah = list.find((p) => p.name === "Sarah") || list[0];
            onProfileChange(sarah);
          }
        }
      } catch (err) {
        console.error("Error loading profiles, seeding locally:", err);
        const localList: Profile[] = [
          { id: "p-sarah", name: "Sarah", avatarColor: "bg-purple-500", createdAt: "" },
          { id: "p-alex", name: "Alex", avatarColor: "bg-teal-500", createdAt: "" },
        ];
        setProfiles(localList);
        if (!activeProfile) {
          onProfileChange(localList[0]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadProfiles();
  }, [userId]);

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim() || !userId) return;

    try {
      const data = {
        id: `p-${Date.now()}`,
        name: newProfileName.trim(),
        avatarColor: selectedColor,
        createdAt: new Date().toISOString(),
      };

      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Uid": userId,
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error(await res.text());
      const created: Profile = await res.json();
      
      setProfiles((prev) => [...prev, created]);
      onProfileChange(created);
      setNewProfileName("");
      setShowAddModal(false);
      setIsOpen(false);
    } catch (err) {
      console.error("Error creating profile:", err);
    }
  };

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  const handleEditProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile || !editName.trim() || !userId) return;

    const updatedProfile = { ...editingProfile, name: editName.trim(), avatarColor: selectedColor };
    
    // Update local state immediately
    const updatedProfiles = profiles.map((p) => (p.id === editingProfile.id ? updatedProfile : p));
    setProfiles(updatedProfiles);
    if (activeProfile?.id === editingProfile.id) {
      onProfileChange(updatedProfile);
    }
    setEditingProfile(null);

    // Sync to Supabase server
    try {
      await fetch(`/api/profiles/${editingProfile.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Uid": userId,
        },
        body: JSON.stringify({
          name: editName.trim(),
          avatarColor: selectedColor,
        }),
      });
    } catch (err) {
      console.warn("Server update warning, kept local change:", err);
    }
  };

  const handleDeleteProfile = async (profileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (profiles.length <= 1) {
      alert("You must keep at least one active household profile.");
      return;
    }

    const updated = profiles.filter((p) => p.id !== profileId);
    setProfiles(updated);

    if (activeProfile?.id === profileId) {
      onProfileChange(updated[0]);
    }

    try {
      await fetch(`/api/profiles/${profileId}`, {
        method: "DELETE",
        headers: {
          "X-User-Uid": userId,
        },
      });
    } catch (err) {
      console.warn("Server delete warning, kept local removal:", err);
    }
  };

  return (
    <div id="profile-switcher" className="relative z-50">
      {/* Current profile button */}
      {activeProfile && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 bg-[#F3F2F7] border border-[#E5E5E5]/40 hover:bg-[#EAEAEA] px-3.5 py-1.5 rounded-full transition text-left focus:outline-none"
        >
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-black shadow-inner ${activeProfile.avatarColor}`}>
            {getInitials(activeProfile.name)}
          </div>
          <span className="text-xs font-bold text-[#1A1A1A] flex items-center gap-1">
            {activeProfile.name}
            <ChevronDown className="w-3 h-3 text-[#7F7F8E] stroke-[2.5]" />
          </span>
        </button>
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-12 left-0 w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl p-2 z-[100] space-y-1 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Profiles
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1">
            {profiles.map((p) => {
              const isActive = activeProfile?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition ${
                    isActive ? "bg-slate-100 text-gray-900 font-bold" : "hover:bg-slate-50 text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <div
                    onClick={() => {
                      onProfileChange(p);
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-2.5 flex-1 cursor-pointer"
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-black ${p.avatarColor}`}>
                      {getInitials(p.name)}
                    </div>
                    <span className="text-xs font-semibold">{p.name}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {isActive && <Check className="w-4 h-4 text-emerald-500 stroke-[3] mr-1" />}
                    
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProfile(p);
                        setEditName(p.name);
                        setSelectedColor(p.avatarColor);
                        setIsOpen(false);
                      }}
                      title="Edit Profile Name"
                      className="p-1 hover:bg-slate-200 text-gray-400 hover:text-gray-700 rounded-lg transition"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDeleteProfile(p.id, e)}
                      title="Delete Profile"
                      className="p-1 hover:bg-rose-100 text-gray-400 hover:text-rose-600 rounded-lg transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

            <div className="border-t border-slate-100 pt-1 mt-1">
              <button
                onClick={() => {
                  setShowAddModal(true);
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-emerald-600 hover:bg-emerald-50/50 rounded-xl text-left transition text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                Add Profile
              </button>
            </div>
          </div>
      )}

      {/* Add Profile Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-5 animate-in zoom-in-95 duration-150 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                <UserPlus className="w-5 h-5 text-emerald-500" />
                Create New Profile
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 hover:bg-slate-100 rounded-full text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProfile} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500">Profile Name</label>
                <input
                  type="text"
                  placeholder="e.g. Chris, Lily"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  maxLength={15}
                  required
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500">Avatar Accent</label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={`w-8 h-8 rounded-full border-2 transition ${color} ${
                        selectedColor === color ? "border-black scale-110" : "border-transparent hover:scale-105"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-black text-white hover:bg-zinc-800 font-bold rounded-xl text-xs transition"
              >
                Save Profile
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingProfile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-5 animate-in zoom-in-95 duration-150 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                <Edit2 className="w-5 h-5 text-emerald-500" />
                Edit Profile
              </h3>
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className="p-1 hover:bg-slate-100 rounded-full text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditProfile} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500">Profile Name</label>
                <input
                  type="text"
                  placeholder="Profile Name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={15}
                  required
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500">Avatar Accent</label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={`w-8 h-8 rounded-full border-2 transition ${color} ${
                        selectedColor === color ? "border-emerald-600 scale-110 shadow-sm" : "border-transparent opacity-80"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingProfile(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-md"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
