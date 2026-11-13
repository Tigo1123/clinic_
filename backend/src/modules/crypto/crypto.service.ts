import { Injectable } from '@nestjs/common';
import {
  encrypt as encryptClinical,
  decrypt as decryptClinical,
} from '../../utils/encryption.js';

// Clinical (medical record) encryption is owned by the legacy src/utils/encryption.js.
// This service only adapts it for Nest injection; do not re-implement the cipher here.
// Decryption failures surface as ClinicalDataDecryptionError from the legacy module.

@Injectable()
export class CryptoService {
  encryptMedical(text: string): string {
    return encryptClinical(text);
  }

  decryptMedical(cipherText: string): string {
    return decryptClinical(cipherText);
  }
}
