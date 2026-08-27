import { create } from "zustand";

export const usePosStore = create((set, get) => ({
  cart: [],
  orderId: null,
  tableId: null,
  tableName: "",

  setTable: (id, name) => set({ tableId: id, tableName: name }),
  setOrder: (id) => set({ orderId: id }),

  loadCart: (items, orderId, tableId, tableName) =>
    set({ cart: items || [], orderId, tableId, tableName }),

  addItem: (product, selectedModifiers = []) => {
    const cart = [...get().cart];
    const key = JSON.stringify((selectedModifiers || []).map((m) => m.option_id).sort());
    const idx = cart.findIndex(
      (c) => c.product_id === product.id && c.print_status !== "printed" && !c.comment &&
        JSON.stringify((c.selected_modifiers || []).map((m) => m.option_id).sort()) === key);
    if (idx >= 0) {
      cart[idx] = { ...cart[idx], count: cart[idx].count + 1 };
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        count: 1,
        workshop_id: product.workshop_id || null,
        course_number: product.course_number || 0,
        comment: null,
        print_status: "pending",
        selected_modifiers: selectedModifiers || [],
      });
    }
    set({ cart });
  },

  setComment: (index, comment) =>
    set({ cart: get().cart.map((c, i) => (i === index ? { ...c, comment: comment || null } : c)) }),

  changeCount: (index, delta) => {
    let cart = get().cart.map((c, i) => (i === index ? { ...c, count: c.count + delta } : c));
    cart = cart.filter((c) => c.count > 0);
    set({ cart });
  },

  removeItem: (index) => set({ cart: get().cart.filter((_, i) => i !== index) }),

  clear: () => set({ cart: [], orderId: null, tableId: null, tableName: "" }),

  subtotal: () => get().cart.reduce(
    (s, c) => s + (c.price + (c.selected_modifiers || []).reduce((a, m) => a + (m.price_delta || 0), 0)) * c.count, 0),
}));
