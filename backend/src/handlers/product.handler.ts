import { Request, Response, NextFunction } from 'express';
import { ProductStatus } from '@prisma/client';
import * as service from '../services/product.service';

export async function listProductsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string'
      ? (req.query.status as ProductStatus)
      : undefined;
    const includeArchived = req.query.includeArchived === 'true';
    const products = await service.listProducts(req.params.id, { status, includeArchived });
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

export async function getProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await service.getProduct(req.params.productId);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

export async function createProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await service.createProduct(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

export async function updateProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await service.updateProduct(req.params.productId, req.body, req.user!.id);
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

export async function deleteProductHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteProduct(req.params.productId, req.user!.id);
    res.json({ success: true, data: { message: 'Product deleted' } });
  } catch (err) {
    next(err);
  }
}
