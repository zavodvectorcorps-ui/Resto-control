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

  addItem: (product) => {
    const cart = [...get().cart];
    const idx = cart.findIndex((c) => c.product_id === product.id && c.print_status !== "printed");
    if (idx >= 0) {
      cart[idx] = { ...cart[idx], count: cart[idx].count + 1 };
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        count: 1,
        workshop_id: product.workshop_id || null,
        print_status: "pending",
      });
    }
    set({ cart });
  },

  changeCount: (index, delta) => {
    let cart = get().cart.map((c, i) => (i === index ? { ...c, count: c.count + delta } : c));
    cart = cart.filter((c) => c.count > 0);
    set({ cart });
  },

  removeItem: (index) => set({ cart: get().cart.filter((_, i) => i !== index) }),

  clear: () => set({ cart: [], orderId: null, tableId: null, tableName: "" }),

  subtotal: () => get().cart.reduce((s, c) => s + c.price * c.count, 0),
}));
