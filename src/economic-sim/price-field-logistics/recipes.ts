import { Recipe } from "./engine";

export const recipes: Recipe[] = [
      {
        id: "factory-product",
        inputs: { labor: 1 },
        requirements: { factory: 1 },
        outputs: { product: 1 },
      },
      /*{
        id: "factory-farming",
        inputs: { labor: 1, product: 1 },
        requirements: { farm: 2 },
        outputs: { food: 6 },
      },*/
      {
        id: "subsistence-food",
        inputs: { labor: 1 },
        requirements: { farm: 1 },
        outputs: { food: 3 },
      },
    ]